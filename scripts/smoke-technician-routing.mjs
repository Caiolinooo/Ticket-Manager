/**
 * Smoke: technician routing helpers + sync account union shape.
 * Run: node scripts/smoke-technician-routing.mjs
 *
 * Does not hit Graph; validates pure filter logic and docs how to test visibility.
 */
import assert from 'assert';

/** Mirror of externalTraceWhereForAccounts / ticketWhereForAccounts (no Prisma). */
function externalTraceWhereForAccounts(visibleAccounts, receiveMode = 'ADMIN') {
  if (visibleAccounts === null) return {};
  if (visibleAccounts.length === 0) return { id: '__none__' };
  if (receiveMode === 'OWN_ONLY') {
    return { accountUpn: { in: visibleAccounts } };
  }
  return {
    OR: [
      { accountUpn: { in: visibleAccounts } },
      { accountUpn: null },
    ],
  };
}

function ticketWhereForAccounts(visibleAccounts, receiveMode = 'ADMIN', userId) {
  if (visibleAccounts === null) return {};
  if (visibleAccounts.length === 0) return { id: '__none__' };
  if (receiveMode === 'OWN_ONLY') {
    const ownClause = [{ accountUpn: { in: visibleAccounts } }];
    if (userId) ownClause.push({ assignedToId: userId });
    return { OR: ownClause };
  }
  return {
    OR: [
      { accountUpn: { in: visibleAccounts } },
      { accountUpn: null },
    ],
  };
}

function uniqueEmails(list) {
  return Array.from(new Set(list.map((e) => e.trim().toLowerCase()).filter(Boolean)));
}

function visibleForTech({ ownEmails, ownTeams, adminAccounts, mode }) {
  const own = uniqueEmails([...ownEmails, ...ownTeams]);
  if (mode === 'OWN_ONLY') return own;
  return uniqueEmails([...own, ...adminAccounts]);
}

// ── Tests ───────────────────────────────────────────────────────────────────

const adminAccounts = ['ti@example.com'];
const techA = {
  ownEmails: ['a@example.com'],
  ownTeams: ['a-teams@example.com'],
  adminAccounts,
  mode: 'OWN_ONLY',
};
const techB = {
  ownEmails: ['b@example.com'],
  ownTeams: [],
  adminAccounts,
  mode: 'SHARED_WITH_ADMIN',
};

const visibleA = visibleForTech(techA);
const visibleB = visibleForTech(techB);

assert.deepStrictEqual(visibleA.sort(), ['a@example.com', 'a-teams@example.com'].sort());
assert.deepStrictEqual(visibleB.sort(), ['b@example.com', 'ti@example.com'].sort());

assert.deepStrictEqual(externalTraceWhereForAccounts(null), {});
assert.deepStrictEqual(externalTraceWhereForAccounts(visibleA, 'OWN_ONLY'), {
  accountUpn: { in: visibleA },
});
const sharedWhere = externalTraceWhereForAccounts(visibleB, 'SHARED_WITH_ADMIN');
assert.ok(Array.isArray(sharedWhere.OR));
assert.ok(sharedWhere.OR.some((c) => c.accountUpn === null));

const syncUnion = uniqueEmails([
  ...adminAccounts,
  ...techA.ownEmails,
  ...techA.ownTeams,
  ...techB.ownEmails,
]);
assert.deepStrictEqual(
  syncUnion.sort(),
  ['ti@example.com', 'a@example.com', 'a-teams@example.com', 'b@example.com'].sort()
);

const ticketOwn = ticketWhereForAccounts(visibleA, 'OWN_ONLY', 'user-a');
assert.ok(ticketOwn.OR.some((c) => c.assignedToId === 'user-a'));

console.log('OK: technician routing smoke passed');
console.log('');
console.log('Manual visibility test (after deploy):');
console.log('  1. Admin → Configurações → Técnicos: criar tech com monitoredEmails=[caixa-x]');
console.log('     receiveMode=OWN_ONLY');
console.log('  2. Inject/sync message with accountUpn=caixa-x → tech vê na pendência');
console.log('  3. Inject with accountUpn=outra-caixa → tech NÃO vê; admin vê');
console.log('  4. KPI tab /api/kpi e export: totais iguais para admin e tech (setor inteiro)');
console.log('  5. Sync Teams/Exchange: monitoredAccounts na resposta inclui união admin+técnicos');
