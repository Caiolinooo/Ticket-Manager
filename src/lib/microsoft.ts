import dns from 'dns';
import { prisma } from './db';

// Force DNS resolution to prefer IPv4 over IPv6 to prevent ENETUNREACH errors on servers without IPv6 routing.
dns.setDefaultResultOrder('ipv4first');

// Microsoft Graph API Service (Production Mode - Dynamic Monitored Accounts)

export interface MicrosoftMessage {
  id: string;
  senderName: string;
  senderEmail: string;
  subjectOrChannel: string;
  bodyPreview: string;
  receivedDateTime: Date;
  platform: 'TEAMS' | 'EXCHANGE';
  /** Teams chatId / channel thread key; Exchange uses sender+subject key */
  conversationId: string;
}

export interface CollectionResult {
  messages: MicrosoftMessage[];
  authOk: boolean;
  disabled: boolean;
  monitoredAccounts: string[];
  warnings: string[];
  errors: string[];
}

class GraphHttpError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string, label = '') {
    const permissionHint = extractMissingPermission(body);
    const suffix = permissionHint ? ` — missing: ${permissionHint}` : '';
    super(`[MS Graph]${label} HTTP ${status}${suffix}`);
    this.status = status;
    this.body = body;
  }
}

function extractMissingPermission(body: string): string | null {
  const match = body.match(/API requires one of '([^']+)'/i);
  return match?.[1] ?? null;
}

async function getAccessToken(): Promise<string | null> {
  const clientId = process.env.MS_GRAPH_CLIENT_ID?.trim().replace(/^["']|["']$/g, '');
  const clientSecret = process.env.MS_GRAPH_CLIENT_SECRET?.trim().replace(/^["']|["']$/g, '');
  const tenantId = process.env.MS_GRAPH_TENANT_ID?.trim().replace(/^["']|["']$/g, '');

  if (!clientId || !clientSecret || !tenantId) {
    console.log('[MS Graph] Credentials not fully configured (MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET, MS_GRAPH_TENANT_ID).');
    return null;
  }

  try {
    const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[MS Graph] Failed to get OAuth token: ${res.status} - ${errText}`);
      return null;
    }

    const data = await res.json();
    console.log('[MS Graph] OAuth token obtained successfully.');
    return data.access_token || null;
  } catch (err) {
    console.error('[MS Graph] Error fetching OAuth token:', err);
    return null;
  }
}

async function getIntegrationConfig(): Promise<{
  monitoredAccounts: string[];
  syncSinceDate: string;
  teamsEnabled: boolean;
  exchangeEnabled: boolean;
}> {
  try {
    const configs = await prisma.systemConfig.findMany({
      where: {
        key: { in: ['monitored_accounts', 'sync_since_date', 'teams_enabled', 'exchange_enabled'] }
      }
    });
    const map: Record<string, string> = {};
    configs.forEach(c => { map[c.key] = c.value; });

    const accounts = (map['monitored_accounts'] || 'user@example.com')
      .split(',').map(e => e.trim()).filter(Boolean);

    const defaultSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const syncSinceDate = map['sync_since_date'] || defaultSince;

    return {
      monitoredAccounts: accounts,
      syncSinceDate,
      teamsEnabled: map['teams_enabled'] !== 'false',
      exchangeEnabled: map['exchange_enabled'] !== 'false',
    };
  } catch (err) {
    console.error('[MS Graph] Error reading integration config from DB:', err);
    return {
      monitoredAccounts: ['user@example.com'],
      syncSinceDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      teamsEnabled: true,
      exchangeEnabled: true,
    };
  }
}

/**
 * Generic paginated fetcher for Microsoft Graph endpoints.
 * Follows @odata.nextLink automatically. Throws GraphHttpError on first failed page.
 */
async function fetchAllPages(url: string, token: string, label = ''): Promise<any[]> {
  const results: any[] = [];
  let nextUrl: string | null = url;

  while (nextUrl) {
    const pageRes: Response = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });

    if (!pageRes.ok) {
      const errBody = await pageRes.text();
      console.warn(`[MS Graph]${label} Paginated request failed: ${pageRes.status} - ${errBody.substring(0, 300)}`);
      throw new GraphHttpError(pageRes.status, errBody, label);
    }

    const pageData: { value?: any[]; '@odata.nextLink'?: string } = await pageRes.json();
    if (Array.isArray(pageData.value)) {
      results.push(...pageData.value);
    }

    nextUrl = pageData['@odata.nextLink'] || null;
  }

  return results;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function emptyResult(partial: Partial<CollectionResult> = {}): CollectionResult {
  return {
    messages: [],
    authOk: partial.authOk ?? false,
    disabled: partial.disabled ?? false,
    monitoredAccounts: partial.monitoredAccounts ?? [],
    warnings: partial.warnings ?? [],
    errors: partial.errors ?? [],
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// STRATEGY 1: User Direct Chats (/users/{id}/chats/{chatId}/messages)
// Requires: Chat.Read.All application permission + admin consent
// ──────────────────────────────────────────────────────────────────────────────
async function fetchTeamsChats(
  targetUser: string,
  token: string,
  sinceCutoff: Date
): Promise<MicrosoftMessage[]> {
  const messages: MicrosoftMessage[] = [];

  console.log(`[Teams/Chats] Fetching chats for: ${targetUser}`);

  const chatsUrl =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(targetUser)}/chats` +
    `?$top=50&$orderby=lastMessagePreview/createdDateTime desc`;

  const chats = await fetchAllPages(chatsUrl, token, ' [Chats]');
  console.log(`[Teams/Chats] ${chats.length} chat(s) found for ${targetUser}`);

  for (const chat of chats) {
    const lastMsgTime = chat.lastMessagePreview?.createdDateTime
      ? new Date(chat.lastMessagePreview.createdDateTime)
      : null;
    if (lastMsgTime && lastMsgTime < sinceCutoff) continue;

    const msgUrl =
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(targetUser)}/chats/${chat.id}/messages` +
      `?$top=50`;

    const msgRes = await fetch(msgUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });

    if (!msgRes.ok) {
      const errBody = await msgRes.text();
      // Meeting/thread chats can 403 even with Chat.Read.All — skip and continue.
      console.warn(
        `[Teams/Chats] Messages fetch skipped for chat ${chat.id}: ${msgRes.status}` +
        (extractMissingPermission(errBody) ? ` — missing: ${extractMissingPermission(errBody)}` : '')
      );
      continue;
    }

    const msgData = await msgRes.json();
    if (!Array.isArray(msgData.value)) continue;

    for (const m of msgData.value) {
      if (m.messageType !== 'message') continue;
      if (m.from?.application) continue;

      const msgCreated = m.createdDateTime ? new Date(m.createdDateTime) : null;
      if (!msgCreated || msgCreated < sinceCutoff) continue;

      const senderEmail = m.from?.user?.userPrincipalName || m.from?.user?.id || '';
      if (senderEmail.toLowerCase() === targetUser.toLowerCase()) continue;

      const cleanContent = stripHtml(m.body?.content || '');
      if (!cleanContent) continue;

      messages.push({
        id: m.id,
        senderName: m.from?.user?.displayName || 'Usuário Teams',
        senderEmail,
        subjectOrChannel: chat.topic || `Chat (${chat.chatType || 'oneOnOne'})`,
        bodyPreview: cleanContent.substring(0, 1500),
        receivedDateTime: msgCreated,
        platform: 'TEAMS',
        conversationId: `teams-chat:${chat.id}`,
      });
    }
  }

  return messages;
}

// ──────────────────────────────────────────────────────────────────────────────
// STRATEGY 2: Joined Teams Channels (/users/{id}/joinedTeams → /channels → /messages)
// Requires: Team.ReadBasic.All (or User.Read.All) + ChannelMessage.Read.All
// ──────────────────────────────────────────────────────────────────────────────
async function fetchTeamsChannelMessages(
  targetUser: string,
  token: string,
  sinceCutoff: Date
): Promise<MicrosoftMessage[]> {
  const messages: MicrosoftMessage[] = [];

  console.log(`[Teams/Channels] Fetching joined teams for: ${targetUser}`);

  const teamsUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(targetUser)}/joinedTeams`;
  const teams = await fetchAllPages(teamsUrl, token, ' [JoinedTeams]');
  console.log(`[Teams/Channels] ${teams.length} team(s) found for ${targetUser}`);

  for (const team of teams) {
    const channelsUrl = `https://graph.microsoft.com/v1.0/teams/${team.id}/channels`;
    const channels = await fetchAllPages(channelsUrl, token, ' [Channels]');

    for (const channel of channels) {
      const sinceIso = sinceCutoff.toISOString();
      const msgUrl =
        `https://graph.microsoft.com/v1.0/teams/${team.id}/channels/${channel.id}/messages` +
        `?$top=50&$filter=createdDateTime ge ${sinceIso}`;

      const msgRes = await fetch(msgUrl, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });

      if (!msgRes.ok) {
        const errBody = await msgRes.text();
        // 403 on a single channel can be scope/policy — record but continue other channels
        if (msgRes.status === 403) {
          console.warn(
            `[Teams/Channels] 403 on channel ${channel.displayName} — ` +
            `${extractMissingPermission(errBody) || 'permission denied'}`
          );
          continue;
        }
        console.warn(`[Teams/Channels] Messages fetch error for channel ${channel.displayName}: ${msgRes.status}`);
        continue;
      }

      const msgData = await msgRes.json();
      if (!Array.isArray(msgData.value)) continue;

      for (const m of msgData.value) {
        if (m.messageType !== 'message') continue;
        if (!m.from?.user) continue;

        const msgCreated = m.createdDateTime ? new Date(m.createdDateTime) : null;
        if (!msgCreated || msgCreated < sinceCutoff) continue;

        const senderEmail = m.from.user.userPrincipalName || m.from.user.id || '';
        const cleanContent = stripHtml(m.body?.content || '');
        if (!cleanContent) continue;

        messages.push({
          id: `${team.id}_${channel.id}_${m.id}`,
          senderName: m.from.user.displayName || 'Membro do Teams',
          senderEmail,
          subjectOrChannel: `${team.displayName} › ${channel.displayName}`,
          bodyPreview: cleanContent.substring(0, 1500),
          receivedDateTime: msgCreated,
          platform: 'TEAMS',
          conversationId: `teams-channel:${team.id}:${channel.id}`,
        });
      }
    }
  }

  return messages;
}

/**
 * Main export: Fetch Teams messages using dual strategy.
 * Surfaces auth/permission failures instead of returning a silent empty success.
 */
export async function fetchTeamsMessages(): Promise<CollectionResult> {
  const config = await getIntegrationConfig();

  if (!config.teamsEnabled) {
    console.log('[Teams] Integration is disabled in settings.');
    return emptyResult({
      disabled: true,
      authOk: true,
      monitoredAccounts: config.monitoredAccounts,
      warnings: ['Integração Teams desabilitada em Configurações.'],
    });
  }

  const token = await getAccessToken();
  if (!token) {
    console.log('[Teams] No OAuth token — skipping Teams sync.');
    return emptyResult({
      authOk: false,
      monitoredAccounts: config.monitoredAccounts,
      errors: [
        'Falha de autenticação Microsoft Graph (token). Verifique MS_GRAPH_CLIENT_ID/SECRET/TENANT_ID.',
      ],
    });
  }

  const sinceCutoff = new Date(config.syncSinceDate + 'T00:00:00Z');
  console.log(`[Teams] Sync cutoff: ${sinceCutoff.toISOString()}`);

  const allMessages: MicrosoftMessage[] = [];
  const seenIds = new Set<string>();
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const targetUser of config.monitoredAccounts) {
    try {
      const chatMsgs = await fetchTeamsChats(targetUser, token, sinceCutoff);
      console.log(`[Teams/Chats] ${chatMsgs.length} message(s) from chats of ${targetUser}`);
      for (const m of chatMsgs) {
        if (!seenIds.has(m.id)) {
          seenIds.add(m.id);
          allMessages.push(m);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Teams/Chats] Error for ${targetUser}:`, msg);
      errors.push(`Chats (${targetUser}): ${msg}`);
    }

    try {
      const channelMsgs = await fetchTeamsChannelMessages(targetUser, token, sinceCutoff);
      console.log(`[Teams/Channels] ${channelMsgs.length} message(s) from channels of ${targetUser}`);
      for (const m of channelMsgs) {
        if (!seenIds.has(m.id)) {
          seenIds.add(m.id);
          allMessages.push(m);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Teams/Channels] Error for ${targetUser}:`, msg);
      errors.push(`Channels (${targetUser}): ${msg}`);
    }
  }

  if (errors.some(e => e.includes('Chat.Read') || e.includes('Chat.ReadBasic') || e.includes('Chat.ReadWrite'))) {
    warnings.push(
      'Permissão Azure pendente/ausente: conceda Chat.Read.All (Application) com Admin Consent.'
    );
  }
  if (errors.some(e => e.includes('Team.ReadBasic') || e.includes('User.Read.All') || e.includes('Directory.Read'))) {
    warnings.push(
      'Permissão Azure pendente/ausente: conceda Team.ReadBasic.All (ou User.Read.All) + ChannelMessage.Read.All com Admin Consent.'
    );
  }

  console.log(`[Teams] Total unique candidate messages: ${allMessages.length}; errors=${errors.length}`);
  return {
    messages: allMessages,
    authOk: true,
    disabled: false,
    monitoredAccounts: config.monitoredAccounts,
    warnings,
    errors,
  };
}

/**
 * Fetch incoming emails from monitored Office 365 Exchange mailboxes.
 * Requires: Mail.Read application permission.
 */
export async function fetchExchangeEmails(): Promise<CollectionResult> {
  const config = await getIntegrationConfig();

  if (!config.exchangeEnabled) {
    console.log('[Exchange] Integration is disabled.');
    return emptyResult({
      disabled: true,
      authOk: true,
      monitoredAccounts: config.monitoredAccounts,
      warnings: ['Integração Exchange/Email desabilitada em Configurações.'],
    });
  }

  const token = await getAccessToken();
  if (!token) {
    console.log('[Exchange] No OAuth token — skipping Exchange sync.');
    return emptyResult({
      authOk: false,
      monitoredAccounts: config.monitoredAccounts,
      errors: [
        'Falha de autenticação Microsoft Graph (token). Verifique MS_GRAPH_CLIENT_ID/SECRET/TENANT_ID.',
      ],
    });
  }

  const sinceDateTime = new Date(config.syncSinceDate + 'T00:00:00Z').toISOString();
  const emails: MicrosoftMessage[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const targetUser of config.monitoredAccounts) {
    try {
      console.log(`[Exchange] Syncing for: ${targetUser} since ${sinceDateTime}`);

      const filter = encodeURIComponent(`receivedDateTime ge ${sinceDateTime}`);
      const url =
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(targetUser)}/mailFolders/Inbox/messages` +
        `?$top=50&$select=id,from,subject,bodyPreview,receivedDateTime,isRead` +
        `&$filter=${filter}&$orderby=receivedDateTime desc`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });

      if (!res.ok) {
        const errBody = await res.text();
        console.error(`[Exchange] API error for ${targetUser}: ${res.status} - ${errBody.substring(0, 300)}`);
        errors.push(`${targetUser}: HTTP ${res.status}${extractMissingPermission(errBody) ? ` — missing: ${extractMissingPermission(errBody)}` : ''}`);
        continue;
      }

      const data = await res.json();
      if (!Array.isArray(data.value)) continue;

      console.log(`[Exchange] ${data.value.length} email(s) for ${targetUser}`);

      for (const msg of data.value) {
        const senderEmail = msg.from?.emailAddress?.address || '';
        const senderName = msg.from?.emailAddress?.name || 'Remetente Desconhecido';
        const subject = msg.subject || '(Sem Assunto)';

        const automatedPatterns = [
          'noreply', 'no-reply', 'donotreply', 'do-not-reply',
          'mailer-daemon', 'postmaster', 'notifications@', 'alert@',
        ];
        if (automatedPatterns.some(p => senderEmail.toLowerCase().includes(p))) continue;

        const normalizedSubject = subject
          .replace(/^(re|fw|enc|res):\s*/gi, '')
          .trim()
          .toLowerCase();

        emails.push({
          id: msg.id,
          senderName,
          senderEmail,
          subjectOrChannel: subject,
          bodyPreview: (msg.bodyPreview || '').substring(0, 1500),
          receivedDateTime: new Date(msg.receivedDateTime || Date.now()),
          platform: 'EXCHANGE',
          conversationId: `email:${senderEmail.toLowerCase()}:${normalizedSubject || '(sem-assunto)'}`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Exchange] Failed for ${targetUser}:`, msg);
      errors.push(`${targetUser}: ${msg}`);
    }
  }

  if (emails.length === 0 && errors.length === 0) {
    warnings.push('Nenhum e-mail candidato no período configurado (sync_since_date).');
  }

  console.log(`[Exchange] Total candidate emails: ${emails.length}; errors=${errors.length}`);
  return {
    messages: emails,
    authOk: true,
    disabled: false,
    monitoredAccounts: config.monitoredAccounts,
    warnings,
    errors,
  };
}
