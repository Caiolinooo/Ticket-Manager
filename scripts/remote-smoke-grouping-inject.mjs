/**
 * Smoke inject: 2 Teams msgs same chat → expect 1 pendência with grouped content.
 * Run on server: node scripts/remote-smoke-grouping-inject.mjs
 */
const base = process.env.SMOKE_BASE || 'http://127.0.0.1:9120';

const body = {
  messages: [
    {
      senderName: 'Ericka Relvas',
      senderEmail: 'ericka.smoke@example.com',
      content: 'Nao consigo abrir o sistema SAP',
      channelName: 'Chat Privado',
      conversationId: 'teams-chat:smoke-ericka-1',
      receivedAt: '2026-07-19T14:16:01.000Z',
    },
    {
      senderName: 'Ericka Relvas',
      senderEmail: 'ericka.smoke@example.com',
      content: 'Continua dando erro de senha',
      channelName: 'Chat Privado',
      conversationId: 'teams-chat:smoke-ericka-1',
      receivedAt: '2026-07-19T14:16:33.000Z',
    },
  ],
};

const res = await fetch(`${base}/api/integrations/teams`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const data = await res.json();
console.log(JSON.stringify(data, null, 2));

if (!res.ok || !data.success) {
  console.error('FAIL: inject unsuccessful');
  process.exit(1);
}

const pending = data.newPendingTraces || [];
const content = data.sampleContent || pending[0]?.content || '';

if (data.clusters !== 1 && data.created + data.merged < 1) {
  console.error('FAIL: expected 1 cluster upsert');
  process.exit(1);
}

if (!String(content).includes('Contexto agrupado')) {
  console.error('FAIL: missing grouped context header');
  process.exit(1);
}

if (!String(content).includes('Nao consigo abrir') || !String(content).includes('Continua dando erro')) {
  console.error('FAIL: both messages not in content');
  process.exit(1);
}

console.log('OK: 2 msgs → grouped pendência with concatenated context');
console.log('created=', data.created, 'merged=', data.merged, 'clusters=', data.clusters);
