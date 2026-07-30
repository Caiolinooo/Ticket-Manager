/**
 * Smoke unitário das fórmulas SLA / MTTR / MTTFR / compliance.
 * Run: node scripts/smoke-kpi-metrics.mjs
 *
 * Mirror leve de src/lib/kpi-metrics.ts (sem TS) para validar contratos.
 */
import assert from 'node:assert/strict';

const SLA_TARGET_MS = {
  URGENT: 2 * 60 * 60 * 1000,
  HIGH: 2 * 60 * 60 * 1000,
  MEDIUM: 24 * 60 * 60 * 1000,
  LOW: 72 * 60 * 60 * 1000,
};

function isResolved(status) {
  return status === 'RESOLVED' || status === 'CLOSED';
}

function getTarget(priority) {
  return SLA_TARGET_MS[priority] ?? SLA_TARGET_MS.MEDIUM;
}

function evaluateSla(ticket, nowMs) {
  const created = new Date(ticket.createdAt).getTime();
  let elapsed;
  if (isResolved(ticket.status)) {
    if (!ticket.resolvedAt) return null;
    elapsed = new Date(ticket.resolvedAt).getTime() - created;
    if (elapsed < 0) return null;
    return elapsed <= getTarget(ticket.priority) ? 'met' : 'breached';
  }
  elapsed = nowMs - created;
  if (elapsed < 0) return null;
  return elapsed > getTarget(ticket.priority) ? 'breached' : 'within';
}

function resolutionMs(ticket) {
  if (!isResolved(ticket.status) || !ticket.resolvedAt) return null;
  const ms = new Date(ticket.resolvedAt).getTime() - new Date(ticket.createdAt).getTime();
  return ms >= 0 ? ms : null;
}

function firstResponseMs(ticket) {
  if (!ticket.createdById || !ticket.messages?.length) return null;
  const created = new Date(ticket.createdAt).getTime();
  const agent = ticket.messages
    .filter((m) => m.senderId !== ticket.createdById)
    .map((m) => new Date(m.createdAt).getTime())
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);
  if (!agent.length) return null;
  const ms = agent[0] - created;
  return ms >= 0 ? ms : null;
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function computeSummary(tickets, nowMs) {
  let resolved = 0;
  let slaMet = 0;
  let slaBreached = 0;
  let slaWithin = 0;
  let openSlaBreaches = 0;
  const resolveVals = [];
  const frVals = [];

  for (const t of tickets) {
    if (isResolved(t.status)) resolved += 1;
    const dur = resolutionMs(t);
    if (dur != null) resolveVals.push(dur);
    const fr = firstResponseMs(t);
    if (fr != null) frVals.push(fr);
    const outcome = evaluateSla(t, nowMs);
    if (outcome === 'met') slaMet += 1;
    else if (outcome === 'breached') {
      slaBreached += 1;
      if (!isResolved(t.status)) openSlaBreaches += 1;
    } else if (outcome === 'within') slaWithin += 1;
  }

  const decided = slaMet + slaBreached;
  const mttr = mean(resolveVals);
  const mttfr = mean(frVals);

  return {
    total: tickets.length,
    resolved,
    mttrHours: mttr == null ? null : mttr / (1000 * 60 * 60),
    mttfrHours: mttfr == null ? null : mttfr / (1000 * 60 * 60),
    slaMet,
    slaBreached,
    slaWithin,
    openSlaBreaches,
    slaCompliancePct: decided > 0 ? (slaMet / decided) * 100 : null,
    resolutionRate: tickets.length > 0 ? (resolved / tickets.length) * 100 : 0,
  };
}

const t0 = new Date('2026-07-30T10:00:00Z').getTime();
const now = t0 + 5 * 60 * 60 * 1000; // +5h

const tickets = [
  // Resolved within HIGH 2h → met
  {
    id: '1',
    status: 'RESOLVED',
    priority: 'HIGH',
    createdAt: new Date(t0).toISOString(),
    resolvedAt: new Date(t0 + 60 * 60 * 1000).toISOString(),
    createdById: 'user',
    messages: [{ senderId: 'agent', createdAt: new Date(t0 + 15 * 60 * 1000).toISOString() }],
  },
  // Resolved after URGENT 2h → breached
  {
    id: '2',
    status: 'CLOSED',
    priority: 'URGENT',
    createdAt: new Date(t0).toISOString(),
    resolvedAt: new Date(t0 + 3 * 60 * 60 * 1000).toISOString(),
    createdById: 'user',
    messages: [],
  },
  // Open HIGH age 5h → breached open
  {
    id: '3',
    status: 'OPEN',
    priority: 'HIGH',
    createdAt: new Date(t0).toISOString(),
    resolvedAt: null,
    createdById: 'user',
    messages: [{ senderId: 'user', createdAt: new Date(t0 + 5 * 60 * 1000).toISOString() }],
  },
  // Open MEDIUM age 5h (<24h) → within
  {
    id: '4',
    status: 'IN_PROGRESS',
    priority: 'MEDIUM',
    createdAt: new Date(t0).toISOString(),
    resolvedAt: null,
    createdById: 'user',
    messages: [{ senderId: 'agent', createdAt: new Date(t0 + 30 * 60 * 1000).toISOString() }],
  },
  // Resolved without resolvedAt → unevaluated for duration; SLA null
  {
    id: '5',
    status: 'RESOLVED',
    priority: 'LOW',
    createdAt: new Date(t0).toISOString(),
    resolvedAt: null,
    createdById: 'user',
    messages: [],
  },
];

assert.equal(evaluateSla(tickets[0], now), 'met');
assert.equal(evaluateSla(tickets[1], now), 'breached');
assert.equal(evaluateSla(tickets[2], now), 'breached');
assert.equal(evaluateSla(tickets[3], now), 'within');
assert.equal(evaluateSla(tickets[4], now), null);

const summary = computeSummary(tickets, now);
assert.equal(summary.total, 5);
assert.equal(summary.resolved, 3);
assert.equal(summary.slaMet, 1);
assert.equal(summary.slaBreached, 2);
assert.equal(summary.slaWithin, 1);
assert.equal(summary.openSlaBreaches, 1);
assert.ok(summary.slaCompliancePct != null);
assert.equal(Number(summary.slaCompliancePct.toFixed(1)), 33.3);

// MTTR: only tickets 1 and 2 (1h + 3h) / 2 = 2h
assert.ok(summary.mttrHours != null);
assert.equal(Number(summary.mttrHours.toFixed(1)), 2.0);

// MTTFR: tickets 1 (15min) and 4 (30min) → 0.375h
assert.ok(summary.mttfrHours != null);
assert.equal(Number(summary.mttfrHours.toFixed(3)), 0.375);

// Empty set
const empty = computeSummary([], now);
assert.equal(empty.total, 0);
assert.equal(empty.mttrHours, null);
assert.equal(empty.slaCompliancePct, null);

console.log('smoke-kpi-metrics: OK');
console.log(
  JSON.stringify(
    {
      slaCompliancePct: summary.slaCompliancePct,
      mttrHours: summary.mttrHours,
      mttfrHours: summary.mttfrHours,
      openSlaBreaches: summary.openSlaBreaches,
    },
    null,
    2
  )
);
