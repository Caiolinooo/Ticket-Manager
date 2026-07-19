import { prisma } from '@/lib/db';
import { analyzeIncomingMessage, type MessageAnalysis } from '@/lib/ai';
import type { MicrosoftMessage } from '@/lib/microsoft';

/** Messages from the same chat/sender within this gap stay in one pendência. */
export const GROUP_WINDOW_MS = 45 * 60 * 1000;

/** Max messages kept in concatenated context (oldest dropped if exceeded). */
const MAX_CONTEXT_MESSAGES = 20;

export interface MessageCluster {
  platform: 'TEAMS' | 'EXCHANGE';
  conversationId: string;
  senderName: string;
  senderEmail: string;
  channelOrSubject: string;
  messages: MicrosoftMessage[];
  firstAt: Date;
  lastAt: Date;
}

export interface UpsertTraceResult {
  action: 'created' | 'merged' | 'skipped';
  traceId?: string;
  status?: string;
  aiAnalysis?: MessageAnalysis;
  messageCount: number;
}

function normalizeSenderEmail(email: string): string {
  return (email || '').trim().toLowerCase();
}

function parseMemberIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
}

function formatTimestamp(d: Date): string {
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/** Build audit-friendly concatenated thread context. */
export function buildGroupedContent(messages: MicrosoftMessage[]): string {
  const sorted = [...messages].sort(
    (a, b) => a.receivedDateTime.getTime() - b.receivedDateTime.getTime()
  );
  const slice = sorted.slice(-MAX_CONTEXT_MESSAGES);
  const header = `[Contexto agrupado — ${slice.length} mensagem(ns) do mesmo chat/thread]`;
  const body = slice
    .map((m) => `[${formatTimestamp(m.receivedDateTime)}] ${m.senderName}: ${m.bodyPreview.trim()}`)
    .join('\n\n');
  return `${header}\n\n${body}`;
}

/**
 * Cluster messages by conversation + sender, merging when gaps are within GROUP_WINDOW_MS.
 * Different subjects/chats or a large time gap → separate clusters (new atendimento).
 */
export function clusterMessages(messages: MicrosoftMessage[]): MessageCluster[] {
  const sorted = [...messages].sort(
    (a, b) => a.receivedDateTime.getTime() - b.receivedDateTime.getTime()
  );

  const clusters: MessageCluster[] = [];

  for (const msg of sorted) {
    const email = normalizeSenderEmail(msg.senderEmail);
    const conversationId = msg.conversationId || `${msg.platform}:${msg.id}`;

    let attached = false;
    for (let i = clusters.length - 1; i >= 0; i--) {
      const c = clusters[i];
      if (c.conversationId !== conversationId) continue;
      if (normalizeSenderEmail(c.senderEmail) !== email) continue;

      const gap = msg.receivedDateTime.getTime() - c.lastAt.getTime();
      if (gap < 0) continue;
      if (gap > GROUP_WINDOW_MS) continue;

      c.messages.push(msg);
      c.lastAt = msg.receivedDateTime;
      attached = true;
      break;
    }

    if (!attached) {
      clusters.push({
        platform: msg.platform,
        conversationId,
        senderName: msg.senderName,
        senderEmail: msg.senderEmail,
        channelOrSubject: msg.subjectOrChannel,
        messages: [msg],
        firstAt: msg.receivedDateTime,
        lastAt: msg.receivedDateTime,
      });
    }
  }

  return clusters;
}

async function findKnownMessageIds(messageIds: string[]): Promise<Set<string>> {
  const known = new Set<string>();
  if (messageIds.length === 0) return known;

  const byExternalId = await prisma.externalTrace.findMany({
    where: { externalId: { in: messageIds } },
    select: { externalId: true, memberIds: true },
  });

  for (const row of byExternalId) {
    known.add(row.externalId);
    for (const id of parseMemberIds(row.memberIds)) known.add(id);
  }

  // Also scan recent traces that may list these as members (group externalIds)
  const recent = await prisma.externalTrace.findMany({
    where: {
      OR: messageIds.map((id) => ({ memberIds: { contains: id } })),
    },
    select: { memberIds: true, externalId: true },
    take: 50,
  });

  for (const row of recent) {
    for (const id of parseMemberIds(row.memberIds)) {
      if (messageIds.includes(id)) known.add(id);
    }
  }

  return known;
}

async function findOpenPendingForConversation(
  platform: string,
  conversationId: string,
  senderEmail: string,
  around: Date
): Promise<{
  id: string;
  rawContent: string;
  memberIds: string | null;
  externalId: string;
  receivedAt: Date;
  status: string;
} | null> {
  const windowStart = new Date(around.getTime() - GROUP_WINDOW_MS);
  const windowEnd = new Date(around.getTime() + GROUP_WINDOW_MS);
  const emailLower = normalizeSenderEmail(senderEmail);

  const candidates = await prisma.externalTrace.findMany({
    where: {
      platform,
      conversationId,
      status: 'PENDING_APPROVAL',
      receivedAt: { gte: windowStart, lte: windowEnd },
    },
    orderBy: { receivedAt: 'desc' },
    take: 10,
  });

  for (const c of candidates) {
    const match = c.originalSender.match(/\(([^)]+)\)/);
    const candidateEmail = normalizeSenderEmail(match?.[1] || c.originalSender);
    if (candidateEmail === emailLower) {
      return c;
    }
  }

  return null;
}

/**
 * Upsert a clustered conversation into a single ExternalTrace (PENDING or IGNORED).
 * Merges into an open PENDING for the same chat/sender/window when present.
 */
export async function upsertGroupedTrace(cluster: MessageCluster): Promise<UpsertTraceResult> {
  const allIds = cluster.messages.map((m) => m.id);
  const known = await findKnownMessageIds(allIds);
  const newMessages = cluster.messages.filter((m) => !known.has(m.id));

  if (newMessages.length === 0) {
    return { action: 'skipped', messageCount: 0 };
  }

  const senderLabel = `${cluster.senderName} (${cluster.senderEmail})`;
  const existingPending = await findOpenPendingForConversation(
    cluster.platform,
    cluster.conversationId,
    cluster.senderEmail,
    cluster.lastAt
  );

  if (existingPending) {
    const prevMembers = parseMemberIds(existingPending.memberIds);
    const mergedMembers = Array.from(new Set([...prevMembers, ...allIds, existingPending.externalId]));
    // Rebuild full context from previous text + only truly new lines when possible
    const mergedContent = buildGroupedContent(cluster.messages);
    // Prefer keeping prior context if it already had more history than this sync batch
    const finalContent =
      existingPending.rawContent.includes('[Contexto agrupado') &&
      existingPending.rawContent.length > mergedContent.length
        ? appendNewMessagesToContent(existingPending.rawContent, newMessages)
        : mergeContents(existingPending.rawContent, mergedContent, newMessages);

    const analysis = await analyzeIncomingMessage(
      finalContent,
      cluster.senderName,
      cluster.platform,
      {
        conversationId: cluster.conversationId,
        existingPendingSummary: existingPending.rawContent.substring(0, 400),
      }
    );

    // Never downgrade an open PENDING on merge — append context; human closes/approves.
    const updated = await prisma.externalTrace.update({
      where: { id: existingPending.id },
      data: {
        rawContent: finalContent,
        memberIds: JSON.stringify(mergedMembers),
        receivedAt: cluster.lastAt > existingPending.receivedAt ? cluster.lastAt : existingPending.receivedAt,
        channelOrSubject: cluster.channelOrSubject || undefined,
        status: 'PENDING_APPROVAL',
      },
    });

    return {
      action: 'merged',
      traceId: updated.id,
      status: updated.status,
      aiAnalysis: analysis,
      messageCount: newMessages.length,
    };
  }

  const groupedContent = buildGroupedContent(newMessages);
  const analysis = await analyzeIncomingMessage(
    groupedContent,
    cluster.senderName,
    cluster.platform,
    { conversationId: cluster.conversationId }
  );

  // Stable group id from conversation + first message (unique constraint)
  const groupExternalId = `group:${cluster.platform}:${cluster.conversationId}:${newMessages[0].id}`;

  const trace = await prisma.externalTrace.create({
    data: {
      platform: cluster.platform,
      externalId: groupExternalId,
      conversationId: cluster.conversationId,
      memberIds: JSON.stringify(allIds),
      originalSender: senderLabel,
      channelOrSubject: cluster.channelOrSubject,
      rawContent: groupedContent,
      status: analysis.isIssue ? 'PENDING_APPROVAL' : 'IGNORED',
      receivedAt: cluster.lastAt,
    },
  });

  return {
    action: 'created',
    traceId: trace.id,
    status: trace.status,
    aiAnalysis: analysis,
    messageCount: newMessages.length,
  };
}

function appendNewMessagesToContent(existing: string, newMessages: MicrosoftMessage[]): string {
  if (newMessages.length === 0) return existing;
  const addition = newMessages
    .sort((a, b) => a.receivedDateTime.getTime() - b.receivedDateTime.getTime())
    .map((m) => `[${formatTimestamp(m.receivedDateTime)}] ${m.senderName}: ${m.bodyPreview.trim()}`)
    .join('\n\n');
  return `${existing}\n\n${addition}`;
}

function mergeContents(
  existing: string,
  rebuilt: string,
  newMessages: MicrosoftMessage[]
): string {
  if (!existing || !existing.trim()) return rebuilt;
  if (existing.includes('[Contexto agrupado')) {
    return appendNewMessagesToContent(existing, newMessages);
  }
  // Legacy single-line pendência: wrap prior + new
  const legacyAsMsg: MicrosoftMessage[] = [
    {
      id: 'legacy',
      senderName: 'Histórico',
      senderEmail: '',
      subjectOrChannel: '',
      bodyPreview: existing,
      receivedDateTime: new Date(0),
      platform: 'TEAMS',
      conversationId: '',
    },
    ...newMessages,
  ];
  return buildGroupedContent(legacyAsMsg);
}

/**
 * Process a batch of collected messages: cluster → upsert grouped traces.
 */
export async function processMessageBatch(messages: MicrosoftMessage[]): Promise<{
  processedClusters: number;
  newPendingTraces: Array<{
    traceId: string;
    sender: string;
    content: string;
    aiAnalysis: MessageAnalysis;
    action: 'created' | 'merged';
  }>;
  skipped: number;
  merged: number;
  created: number;
}> {
  const clusters = clusterMessages(messages);
  const newPendingTraces: Array<{
    traceId: string;
    sender: string;
    content: string;
    aiAnalysis: MessageAnalysis;
    action: 'created' | 'merged';
  }> = [];

  let skipped = 0;
  let merged = 0;
  let created = 0;

  for (const cluster of clusters) {
    const result = await upsertGroupedTrace(cluster);

    if (result.action === 'skipped') {
      skipped += 1;
      continue;
    }
    if (result.action === 'merged') merged += 1;
    if (result.action === 'created') created += 1;

    if (
      result.traceId &&
      result.status === 'PENDING_APPROVAL' &&
      result.aiAnalysis &&
      (result.aiAnalysis.isIssue || result.aiAnalysis.isContinuation)
    ) {
      const trace = await prisma.externalTrace.findUnique({ where: { id: result.traceId } });
      if (trace) {
        newPendingTraces.push({
          traceId: trace.id,
          sender: trace.originalSender,
          content: trace.rawContent,
          aiAnalysis: result.aiAnalysis,
          action: result.action,
        });
      }
    }
  }

  return {
    processedClusters: clusters.length,
    newPendingTraces,
    skipped,
    merged,
    created,
  };
}
