/**
 * Smoke: 2 msgs same chat → 1 cluster; gap > 45min or different chat → 2 clusters.
 * Run: node scripts/smoke-trace-grouping.mjs
 */
import assert from 'node:assert/strict';

const GROUP_WINDOW_MS = 45 * 60 * 1000;

function clusterMessages(messages) {
  const sorted = [...messages].sort(
    (a, b) => a.receivedDateTime.getTime() - b.receivedDateTime.getTime()
  );
  const clusters = [];
  for (const msg of sorted) {
    const email = (msg.senderEmail || '').trim().toLowerCase();
    let attached = false;
    for (let i = clusters.length - 1; i >= 0; i--) {
      const c = clusters[i];
      if (c.conversationId !== msg.conversationId) continue;
      if ((c.senderEmail || '').trim().toLowerCase() !== email) continue;
      const gap = msg.receivedDateTime.getTime() - c.lastAt.getTime();
      if (gap < 0 || gap > GROUP_WINDOW_MS) continue;
      c.messages.push(msg);
      c.lastAt = msg.receivedDateTime;
      attached = true;
      break;
    }
    if (!attached) {
      clusters.push({
        conversationId: msg.conversationId,
        senderEmail: msg.senderEmail,
        messages: [msg],
        lastAt: msg.receivedDateTime,
      });
    }
  }
  return clusters;
}

function buildGroupedContent(messages) {
  const sorted = [...messages].sort(
    (a, b) => a.receivedDateTime.getTime() - b.receivedDateTime.getTime()
  );
  const header = `[Contexto agrupado — ${sorted.length} mensagem(ns) do mesmo chat/thread]`;
  const body = sorted
    .map((m) => `[${m.receivedDateTime.toISOString()}] ${m.senderName}: ${m.bodyPreview}`)
    .join('\n\n');
  return `${header}\n\n${body}`;
}

const t0 = new Date('2026-07-19T14:16:01Z');
const t1 = new Date('2026-07-19T14:16:33Z');
const tFar = new Date('2026-07-19T16:00:00Z');

const sameChat = [
  {
    id: 'm1',
    senderName: 'Ericka Relvas',
    senderEmail: 'ericka@example.com',
    bodyPreview: 'Não consigo abrir o sistema',
    receivedDateTime: t0,
    conversationId: 'teams-chat:abc',
  },
  {
    id: 'm2',
    senderName: 'Ericka Relvas',
    senderEmail: 'ericka@example.com',
    bodyPreview: 'Continua dando erro de senha',
    receivedDateTime: t1,
    conversationId: 'teams-chat:abc',
  },
];

const clusters1 = clusterMessages(sameChat);
assert.equal(clusters1.length, 1, 'same chat within window → 1 cluster');
assert.equal(clusters1[0].messages.length, 2);

const content = buildGroupedContent(clusters1[0].messages);
assert.match(content, /Contexto agrupado/);
assert.match(content, /Não consigo abrir o sistema/);
assert.match(content, /Continua dando erro de senha/);

const splitByGap = clusterMessages([
  ...sameChat,
  {
    id: 'm3',
    senderName: 'Ericka Relvas',
    senderEmail: 'ericka@example.com',
    bodyPreview: 'Outro problema agora com impressora',
    receivedDateTime: tFar,
    conversationId: 'teams-chat:abc',
  },
]);
assert.equal(splitByGap.length, 2, 'gap > 45min → new cluster');

const splitByChat = clusterMessages([
  sameChat[0],
  {
    ...sameChat[1],
    id: 'm2b',
    conversationId: 'teams-chat:other',
  },
]);
assert.equal(splitByChat.length, 2, 'different chatId → 2 clusters');

console.log('OK smoke-trace-grouping: grouping rules passed');
console.log('Sample content:\n' + content);
