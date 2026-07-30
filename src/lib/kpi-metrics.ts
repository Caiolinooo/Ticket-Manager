/**
 * Shared KPI / SLA / MTTR calculations for Ticket Manager.
 * Used by /api/kpi, /api/export and the Relatórios UI.
 *
 * Time zone for display labels: America/Fortaleza (UTC-3).
 * Durations are wall-clock (not business hours).
 */

export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | string;
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'PENDING' | 'RESOLVED' | 'CLOSED' | string;
export type SlaOutcome = 'met' | 'breached' | 'within';

export interface KpiMessageInput {
  createdAt: Date | string;
  senderId: string;
}

export interface KpiTicketInput {
  id: string;
  title: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: string;
  source: string;
  createdAt: Date | string;
  resolvedAt?: Date | string | null;
  createdById?: string | null;
  assignedToId?: string | null;
  assignee?: { id?: string; name?: string | null; email?: string | null } | null;
  creator?: { name?: string | null; email?: string | null } | null;
  messages?: KpiMessageInput[] | null;
}

/** Resolution SLA targets in milliseconds (legacy HIGH/URGENT = 2h preserved). */
export const SLA_TARGET_MS: Record<string, number> = {
  URGENT: 2 * 60 * 60 * 1000,
  HIGH: 2 * 60 * 60 * 1000,
  MEDIUM: 24 * 60 * 60 * 1000,
  LOW: 72 * 60 * 60 * 1000,
};

export const SLA_TARGET_LABEL: Record<string, string> = {
  URGENT: '2h',
  HIGH: '2h',
  MEDIUM: '24h',
  LOW: '72h',
};

export const SLA_POLICY_HELP =
  'SLA de resolução (tempo corrido): Urgente/Alta 2h · Média 24h · Baixa 72h. ' +
  'Cumprido = resolvido dentro da meta. Estourado = aberto ou resolvido após a meta. ' +
  'Compliance = cumpridos ÷ (cumpridos + estourados). Tickets ainda no prazo não entram no denominador.';

export const MTTR_HELP =
  'MTTR (Mean Time To Resolve): média de (resolvedAt − createdAt) nos tickets Resolvidos/Fechados ' +
  'com data de resolução válida. Tempo corrido (não horário comercial).';

export const MTTFR_HELP =
  'MTTFR (1ª resposta): média até a primeira mensagem de um remetente diferente do solicitante. ' +
  'Tickets sem resposta de agente não entram na média.';

const CLOSED_STATUSES = new Set(['RESOLVED', 'CLOSED']);

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isResolvedStatus(status: string): boolean {
  return CLOSED_STATUSES.has(status);
}

export function getSlaTargetMs(priority: string): number {
  return SLA_TARGET_MS[priority] ?? SLA_TARGET_MS.MEDIUM;
}

export function getSlaTargetLabel(priority: string): string {
  return SLA_TARGET_LABEL[priority] ?? SLA_TARGET_LABEL.MEDIUM;
}

/** Elapsed ms used for SLA: resolved duration or age if still open. */
export function getTicketElapsedMs(ticket: KpiTicketInput, nowMs = Date.now()): number | null {
  const created = toDate(ticket.createdAt);
  if (!created) return null;

  if (isResolvedStatus(ticket.status)) {
    const resolved = toDate(ticket.resolvedAt);
    if (!resolved) return null;
    const ms = resolved.getTime() - created.getTime();
    return ms >= 0 ? ms : null;
  }

  const ms = nowMs - created.getTime();
  return ms >= 0 ? ms : null;
}

export function evaluateSla(ticket: KpiTicketInput, nowMs = Date.now()): SlaOutcome | null {
  const elapsed = getTicketElapsedMs(ticket, nowMs);
  if (elapsed == null) return null;

  const target = getSlaTargetMs(ticket.priority);
  if (isResolvedStatus(ticket.status)) {
    return elapsed <= target ? 'met' : 'breached';
  }
  return elapsed > target ? 'breached' : 'within';
}

export function resolutionDurationMs(ticket: KpiTicketInput): number | null {
  if (!isResolvedStatus(ticket.status)) return null;
  const created = toDate(ticket.createdAt);
  const resolved = toDate(ticket.resolvedAt);
  if (!created || !resolved) return null;
  const ms = resolved.getTime() - created.getTime();
  return ms >= 0 ? ms : null;
}

/** First agent reply: earliest message whose sender ≠ ticket creator. */
export function firstResponseMs(ticket: KpiTicketInput): number | null {
  const created = toDate(ticket.createdAt);
  if (!created || !ticket.createdById || !ticket.messages?.length) return null;

  const agentMsgs = ticket.messages
    .filter((m) => m.senderId && m.senderId !== ticket.createdById)
    .map((m) => toDate(m.createdAt))
    .filter((d): d is Date => d != null)
    .sort((a, b) => a.getTime() - b.getTime());

  if (agentMsgs.length === 0) return null;
  const ms = agentMsgs[0].getTime() - created.getTime();
  return ms >= 0 ? ms : null;
}

export function formatDurationHours(hours: number | null | undefined): string {
  if (hours == null || Number.isNaN(hours)) return '—';
  if (hours < 0) return '—';
  if (hours < 1) {
    const mins = Math.round(hours * 60);
    return `${mins}min`;
  }
  if (hours < 48) return `${hours.toFixed(1)}h`;
  const days = hours / 24;
  return `${days.toFixed(1)}d`;
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export interface CountRow {
  key: string;
  label: string;
  count: number;
}

export interface TechnicianBreakdownRow {
  key: string;
  name: string;
  assigned: number;
  resolved: number;
  open: number;
  slaMet: number;
  slaBreached: number;
  slaWithin: number;
  mttrHours: number | null;
  slaCompliancePct: number | null;
}

export interface DailyVolumeRow {
  day: string;
  created: number;
  resolved: number;
}

export interface KpiSummary {
  total: number;
  resolved: number;
  open: number;
  inProgress: number;
  pending: number;
  backlog: number;
  resolutionRate: number;
  mttrHours: number | null;
  mttrSampleSize: number;
  mttfrHours: number | null;
  mttfrSampleSize: number;
  slaMet: number;
  slaBreached: number;
  slaWithin: number;
  slaUnevaluated: number;
  slaCompliancePct: number | null;
  /** Open tickets currently past SLA (subset of slaBreached that are not closed). */
  openSlaBreaches: number;
  urgentOpen: number;
  highOpen: number;
}

export interface KpiBreakdowns {
  byCategory: CountRow[];
  byStatus: CountRow[];
  bySource: CountRow[];
  byPriority: CountRow[];
  bySla: CountRow[];
  byTechnician: TechnicianBreakdownRow[];
  dailyVolume: DailyVolumeRow[];
}

export interface KpiTrendDelta {
  totalDelta: number | null;
  resolutionRateDelta: number | null;
  mttrHoursDelta: number | null;
  slaComplianceDelta: number | null;
}

export interface KpiReport {
  summary: KpiSummary;
  breakdowns: KpiBreakdowns;
  definitions: {
    sla: string;
    mttr: string;
    mttfr: string;
    targets: typeof SLA_TARGET_LABEL;
  };
}

const CATEGORY_ORDER = ['Hardware', 'Software', 'Acessos', 'Redes', 'Geral'];
const STATUS_ORDER = ['OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED'];
const SOURCE_ORDER = ['PORTAL', 'TEAMS', 'EMAIL'];
const PRIORITY_ORDER = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];

export const STATUS_LABEL_PT: Record<string, string> = {
  OPEN: 'Aberto',
  IN_PROGRESS: 'Em Andamento',
  PENDING: 'Pendente',
  RESOLVED: 'Resolvido',
  CLOSED: 'Fechado',
};

export const PRIORITY_LABEL_PT: Record<string, string> = {
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
  URGENT: 'Urgente',
};

export const SOURCE_LABEL_PT: Record<string, string> = {
  PORTAL: 'Portal',
  TEAMS: 'Teams',
  EMAIL: 'E-mail',
};

function countBy(
  tickets: KpiTicketInput[],
  getKey: (t: KpiTicketInput) => string,
  order: string[],
  labels: Record<string, string>
): CountRow[] {
  const map = new Map<string, number>();
  for (const key of order) map.set(key, 0);
  for (const t of tickets) {
    const key = getKey(t) || 'OUTRO';
    map.set(key, (map.get(key) || 0) + 1);
  }
  const rows: CountRow[] = [];
  for (const [key, count] of map) {
    rows.push({ key, label: labels[key] || key, count });
  }
  rows.sort((a, b) => {
    const ai = order.indexOf(a.key);
    const bi = order.indexOf(b.key);
    if (ai === -1 && bi === -1) return b.count - a.count;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  return rows;
}

function buildTechnicianBreakdown(
  tickets: KpiTicketInput[],
  nowMs: number
): TechnicianBreakdownRow[] {
  type Acc = {
    name: string;
    assigned: number;
    resolved: number;
    open: number;
    slaMet: number;
    slaBreached: number;
    slaWithin: number;
    resolveMs: number[];
  };

  const map = new Map<string, Acc>();

  for (const t of tickets) {
    const key = t.assignee?.id || t.assignedToId || '__unassigned__';
    const name = t.assignee?.name || (key === '__unassigned__' ? 'Não atribuído' : 'Técnico');
    let acc = map.get(key);
    if (!acc) {
      acc = {
        name,
        assigned: 0,
        resolved: 0,
        open: 0,
        slaMet: 0,
        slaBreached: 0,
        slaWithin: 0,
        resolveMs: [],
      };
      map.set(key, acc);
    }
    acc.assigned += 1;
    if (isResolvedStatus(t.status)) {
      acc.resolved += 1;
      const dur = resolutionDurationMs(t);
      if (dur != null) acc.resolveMs.push(dur);
    } else {
      acc.open += 1;
    }

    const outcome = evaluateSla(t, nowMs);
    if (outcome === 'met') acc.slaMet += 1;
    else if (outcome === 'breached') acc.slaBreached += 1;
    else if (outcome === 'within') acc.slaWithin += 1;
  }

  return [...map.entries()]
    .map(([key, acc]) => {
      const decided = acc.slaMet + acc.slaBreached;
      const mttr = mean(acc.resolveMs);
      return {
        key,
        name: acc.name,
        assigned: acc.assigned,
        resolved: acc.resolved,
        open: acc.open,
        slaMet: acc.slaMet,
        slaBreached: acc.slaBreached,
        slaWithin: acc.slaWithin,
        mttrHours: mttr == null ? null : mttr / (1000 * 60 * 60),
        slaCompliancePct: decided > 0 ? (acc.slaMet / decided) * 100 : null,
      };
    })
    .sort((a, b) => b.assigned - a.assigned || a.name.localeCompare(b.name, 'pt-BR'));
}

function buildDailyVolume(tickets: KpiTicketInput[]): DailyVolumeRow[] {
  const map = new Map<string, DailyVolumeRow>();

  const dayKey = (value: Date | string) => {
    const d = toDate(value);
    if (!d) return null;
    return d.toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' });
  };

  for (const t of tickets) {
    const createdDay = dayKey(t.createdAt);
    if (createdDay) {
      const row = map.get(createdDay) || { day: createdDay, created: 0, resolved: 0 };
      row.created += 1;
      map.set(createdDay, row);
    }
    if (isResolvedStatus(t.status) && t.resolvedAt) {
      const resolvedDay = dayKey(t.resolvedAt);
      if (resolvedDay) {
        const row = map.get(resolvedDay) || { day: resolvedDay, created: 0, resolved: 0 };
        row.resolved += 1;
        map.set(resolvedDay, row);
      }
    }
  }

  return [...map.values()].sort((a, b) => {
    // pt-BR dd/mm/yyyy — parse for sort
    const parse = (s: string) => {
      const [dd, mm, yyyy] = s.split('/').map(Number);
      return new Date(yyyy, (mm || 1) - 1, dd || 1).getTime();
    };
    return parse(a.day) - parse(b.day);
  });
}

export function computeKpiSummary(tickets: KpiTicketInput[], nowMs = Date.now()): KpiSummary {
  let resolved = 0;
  let open = 0;
  let inProgress = 0;
  let pending = 0;
  let slaMet = 0;
  let slaBreached = 0;
  let slaWithin = 0;
  let slaUnevaluated = 0;
  let openSlaBreaches = 0;
  let urgentOpen = 0;
  let highOpen = 0;
  const resolveMs: number[] = [];
  const firstRespMs: number[] = [];

  for (const t of tickets) {
    switch (t.status) {
      case 'RESOLVED':
      case 'CLOSED':
        resolved += 1;
        break;
      case 'OPEN':
        open += 1;
        break;
      case 'IN_PROGRESS':
        inProgress += 1;
        break;
      case 'PENDING':
        pending += 1;
        break;
      default:
        break;
    }

    if (!isResolvedStatus(t.status)) {
      if (t.priority === 'URGENT') urgentOpen += 1;
      if (t.priority === 'HIGH') highOpen += 1;
    }

    const dur = resolutionDurationMs(t);
    if (dur != null) resolveMs.push(dur);

    const fr = firstResponseMs(t);
    if (fr != null) firstRespMs.push(fr);

    const outcome = evaluateSla(t, nowMs);
    switch (outcome) {
      case 'met':
        slaMet += 1;
        break;
      case 'breached':
        slaBreached += 1;
        if (!isResolvedStatus(t.status)) openSlaBreaches += 1;
        break;
      case 'within':
        slaWithin += 1;
        break;
      case null:
        slaUnevaluated += 1;
        break;
      default: {
        const _exhaustive: never = outcome;
        void _exhaustive;
        break;
      }
    }
  }

  const total = tickets.length;
  const decided = slaMet + slaBreached;
  const mttr = mean(resolveMs);
  const mttfr = mean(firstRespMs);

  return {
    total,
    resolved,
    open,
    inProgress,
    pending,
    backlog: open + inProgress + pending,
    resolutionRate: total > 0 ? (resolved / total) * 100 : 0,
    mttrHours: mttr == null ? null : mttr / (1000 * 60 * 60),
    mttrSampleSize: resolveMs.length,
    mttfrHours: mttfr == null ? null : mttfr / (1000 * 60 * 60),
    mttfrSampleSize: firstRespMs.length,
    slaMet,
    slaBreached,
    slaWithin,
    slaUnevaluated,
    slaCompliancePct: decided > 0 ? (slaMet / decided) * 100 : null,
    openSlaBreaches,
    urgentOpen,
    highOpen,
  };
}

export function computeKpiBreakdowns(
  tickets: KpiTicketInput[],
  nowMs = Date.now()
): KpiBreakdowns {
  const summary = computeKpiSummary(tickets, nowMs);
  return {
    byCategory: countBy(tickets, (t) => t.category, CATEGORY_ORDER, Object.fromEntries(CATEGORY_ORDER.map((c) => [c, c]))),
    byStatus: countBy(tickets, (t) => t.status, STATUS_ORDER, STATUS_LABEL_PT),
    bySource: countBy(tickets, (t) => t.source, SOURCE_ORDER, SOURCE_LABEL_PT),
    byPriority: countBy(tickets, (t) => t.priority, PRIORITY_ORDER, PRIORITY_LABEL_PT),
    bySla: [
      { key: 'met', label: 'Cumprido', count: summary.slaMet },
      { key: 'breached', label: 'Estourado', count: summary.slaBreached },
      { key: 'within', label: 'No prazo', count: summary.slaWithin },
    ],
    byTechnician: buildTechnicianBreakdown(tickets, nowMs),
    dailyVolume: buildDailyVolume(tickets),
  };
}

export function computeKpiReport(tickets: KpiTicketInput[], nowMs = Date.now()): KpiReport {
  return {
    summary: computeKpiSummary(tickets, nowMs),
    breakdowns: computeKpiBreakdowns(tickets, nowMs),
    definitions: {
      sla: SLA_POLICY_HELP,
      mttr: MTTR_HELP,
      mttfr: MTTFR_HELP,
      targets: SLA_TARGET_LABEL,
    },
  };
}

export function computeTrendDelta(current: KpiSummary, previous: KpiSummary): KpiTrendDelta {
  const delta = (a: number | null, b: number | null): number | null => {
    if (a == null || b == null) return null;
    return a - b;
  };
  return {
    totalDelta: current.total - previous.total,
    resolutionRateDelta: current.resolutionRate - previous.resolutionRate,
    mttrHoursDelta: delta(current.mttrHours, previous.mttrHours),
    slaComplianceDelta: delta(current.slaCompliancePct, previous.slaCompliancePct),
  };
}

/** Previous period of equal length ending the day before `from`. */
export function previousPeriodRange(
  fromIso: string,
  toIso: string
): { from: string; to: string } | null {
  const from = new Date(fromIso + 'T00:00:00Z');
  const to = new Date(toIso + 'T23:59:59Z');
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return null;

  const lengthMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - lengthMs);
  return {
    from: prevFrom.toISOString().slice(0, 10),
    to: prevTo.toISOString().slice(0, 10),
  };
}
