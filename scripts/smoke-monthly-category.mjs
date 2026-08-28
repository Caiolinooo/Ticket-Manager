/**
 * Smoke: matriz mês × categoria (Indicadores SGI).
 * Run: node scripts/smoke-monthly-category.mjs
 */
import assert from 'node:assert/strict';

const SGI = [
  'Atendimento WK Radar',
  'Atendimento Dominio',
  'Atendimento Hardware',
  'Facilities',
  'Desenvolvimento Interno de Software',
];

const ALIAS = {
  hardware: 'Atendimento Hardware',
  software: 'Desenvolvimento Interno de Software',
};

function fold(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function normalize(raw) {
  const t = (raw || '').trim();
  if (!t) return 'Geral';
  const a = ALIAS[fold(t)];
  if (a) return a;
  const exact = SGI.find((c) => fold(c) === fold(t));
  return exact || t;
}

function ym(iso) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(d);
  return {
    year: Number(parts.find((p) => p.type === 'year').value),
    month: Number(parts.find((p) => p.type === 'month').value),
  };
}

function key(y, m) {
  return `${y}-${String(m).padStart(2, '0')}`;
}

function abbr(y, m) {
  return `${['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'][m - 1]}-${y}`;
}

function matrix(tickets, from, to) {
  const counts = new Map();
  const extras = new Set();
  for (const t of tickets) {
    const { year, month } = ym(t.createdAt);
    const cat = normalize(t.category);
    if (!SGI.includes(cat)) extras.add(cat);
    const mk = key(year, month);
    if (!counts.has(mk)) counts.set(mk, new Map());
    const row = counts.get(mk);
    row.set(cat, (row.get(cat) || 0) + 1);
  }
  const fromYm = ym(from + 'T12:00:00-03:00');
  const toYm = ym(to + 'T12:00:00-03:00');
  const categories = [...SGI, ...[...extras].sort()];
  const months = [];
  let y = fromYm.year;
  let m = fromYm.month;
  for (let i = 0; i < 24; i++) {
    const mk = key(y, m);
    const row = counts.get(mk);
    const countsObj = {};
    let total = 0;
    for (const cat of categories) {
      const n = row?.get(cat) || 0;
      countsObj[cat] = n;
      total += n;
    }
    months.push({ key: mk, label: abbr(y, m), counts: countsObj, total });
    if (y === toYm.year && m === toYm.month) break;
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
  }
  return { categories, months };
}

assert.equal(normalize('Hardware'), 'Atendimento Hardware');
assert.equal(normalize('Software'), 'Desenvolvimento Interno de Software');
assert.equal(normalize('Atendimento Dominio'), 'Atendimento Dominio');

const tickets = [
  { category: 'Hardware', createdAt: '2026-07-10T15:00:00-03:00' },
  { category: 'Hardware', createdAt: '2026-07-20T15:00:00-03:00' },
  { category: 'Atendimento Dominio', createdAt: '2026-07-12T10:00:00-03:00' },
  { category: 'Facilities', createdAt: '2026-08-02T10:00:00-03:00' },
  { category: 'Acessos', createdAt: '2026-08-15T10:00:00-03:00' },
];

const report = matrix(tickets, '2026-07-01', '2026-09-30');
assert.equal(report.months.length, 3);
assert.equal(report.months[0].label, 'JUL-2026');
assert.equal(report.months[1].label, 'AGO-2026');
assert.equal(report.months[2].label, 'SET-2026');
assert.equal(report.months[0].counts['Atendimento Hardware'], 2);
assert.equal(report.months[0].counts['Atendimento Dominio'], 1);
assert.equal(report.months[0].total, 3);
assert.equal(report.months[1].counts.Facilities, 1);
assert.equal(report.months[1].counts.Acessos, 1);
assert.equal(report.months[2].total, 0);
assert.ok(report.categories.includes('Acessos'));

console.log('smoke-monthly-category: OK');
console.log(JSON.stringify(report.months.map((m) => ({ ref: m.label, total: m.total })), null, 2));
