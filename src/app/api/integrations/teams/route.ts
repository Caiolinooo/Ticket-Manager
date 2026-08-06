import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { fetchTeamsMessages } from '@/lib/microsoft';
import { analyzeIncomingMessage } from '@/lib/ai';
import {
  buildGroupedContent,
  clusterMessages,
  processMessageBatch,
  upsertGroupedTrace,
  GROUP_WINDOW_MS,
} from '@/lib/trace-grouping';
import type { MicrosoftMessage } from '@/lib/microsoft';
import { getSession } from '@/lib/auth';
import { canTriggerPendencyScan, canSyncMicrosoft } from '@/lib/permissions';

export async function GET() {
  try {
    const session = await getSession();
    if (!canTriggerPendencyScan(session)) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    const collection = await fetchTeamsMessages();
    const batch = await processMessageBatch(collection.messages);

    const hasHardFailure = !collection.authOk || collection.errors.length > 0;

    return NextResponse.json({
      success: !hasHardFailure,
      processedCount: collection.messages.length,
      processedClusters: batch.processedClusters,
      createdTraces: batch.created,
      mergedTraces: batch.merged,
      skippedClusters: batch.skipped,
      groupWindowMinutes: GROUP_WINDOW_MS / 60000,
      newPendingTraces: batch.newPendingTraces,
      authOk: collection.authOk,
      disabled: collection.disabled,
      monitoredAccounts: collection.monitoredAccounts,
      warnings: collection.warnings,
      errors: collection.errors,
      error: hasHardFailure
        ? (collection.errors[0] || 'Falha na coleta Teams')
        : undefined,
    }, { status: hasHardFailure ? 502 : 200 });
  } catch (error: any) {
    console.error('Teams integration error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * Inject custom Teams messages (simulator).
 * Accepts a single message OR an array in `messages` to smoke-test grouping.
 *
 * Body (single):
 *   { senderName, senderEmail, content, channelName?, conversationId?, receivedAt? }
 *
 * Body (batch):
 *   { messages: [{ senderName, senderEmail, content, channelName?, conversationId?, receivedAt? }] }
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!canSyncMicrosoft(session)) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    const body = await request.json();

    const rawList = Array.isArray(body.messages)
      ? body.messages
      : [body];

    const now = Date.now();
    const injected: MicrosoftMessage[] = rawList.map((item: any, idx: number) => {
      const senderName = item.senderName || body.senderName;
      const senderEmail = item.senderEmail || body.senderEmail;
      const content = item.content || item.bodyPreview;
      if (!senderName || !senderEmail || !content) {
        throw new Error('Campos obrigatórios ausentes (senderName, senderEmail, content)');
      }

      const conversationId =
        item.conversationId ||
        body.conversationId ||
        `teams-injected:${senderEmail.toLowerCase()}:${item.channelName || body.channelName || 'Chat Privado'}`;

      const receivedDateTime = item.receivedAt
        ? new Date(item.receivedAt)
        : new Date(now + idx * 1000);

      return {
        id: item.id || `teams-injected-${now}-${idx}`,
        senderName,
        senderEmail,
        subjectOrChannel: item.channelName || body.channelName || 'Chat Privado',
        bodyPreview: content,
        receivedDateTime,
        platform: 'TEAMS' as const,
        conversationId,
        accountUpn: String(item.accountUpn || body.accountUpn || '').trim().toLowerCase(),
      };
    });

    // Prefer full batch processor (groups + upsert)
    if (injected.length > 1 || body.forceGroup) {
      const batch = await processMessageBatch(injected);
      const primary = batch.newPendingTraces[0];
      const clusters = clusterMessages(injected);

      return NextResponse.json({
        success: true,
        grouped: true,
        clusters: clusters.length,
        created: batch.created,
        merged: batch.merged,
        skipped: batch.skipped,
        newPendingTraces: batch.newPendingTraces,
        sampleContent: primary?.content || buildGroupedContent(injected),
        aiAnalysis: primary?.aiAnalysis,
      });
    }

    // Single inject: still go through upsert so it can merge into open PENDING
    const result = await upsertGroupedTrace(clusterMessages(injected)[0]);
    const trace = result.traceId
      ? await prisma.externalTrace.findUnique({ where: { id: result.traceId } })
      : null;

    // Fallback analysis label for UI when skipped
    const aiAnalysis =
      result.aiAnalysis ||
      (await analyzeIncomingMessage(injected[0].bodyPreview, injected[0].senderName, 'TEAMS', {
        conversationId: injected[0].conversationId,
      }));

    return NextResponse.json({
      success: true,
      grouped: true,
      action: result.action,
      trace,
      aiAnalysis,
    });
  } catch (error: any) {
    console.error('Teams injection error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
