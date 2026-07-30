'use client';

import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  Calendar,
  FileSpreadsheet,
  HelpCircle,
  TrendingDown,
  TrendingUp,
  Minus,
  ShieldAlert,
  Clock,
  CheckCircle2,
  Inbox,
} from 'lucide-react';
import {
  computeKpiReport,
  computeTrendDelta,
  evaluateSla,
  formatDurationHours,
  getSlaTargetLabel,
  MTTFR_HELP,
  MTTR_HELP,
  previousPeriodRange,
  PRIORITY_LABEL_PT,
  SLA_POLICY_HELP,
  STATUS_LABEL_PT,
  type KpiTicketInput,
} from '@/lib/kpi-metrics';

export type DatePreset = 'today' | '7d' | '30d' | '90d' | 'custom';

export interface KpiDashboardTicket {
  id: string;
  title: string;
  status: string;
  priority: string;
  category: string;
  source: string;
  createdAt: string;
  resolvedAt?: string | null;
  createdById?: string | null;
  assignedToId?: string | null;
  creator: { name: string; email?: string };
  assignee?: { id?: string; name: string; email?: string } | null;
  messages?: { createdAt: string; senderId: string }[];
}

interface KpiDashboardProps {
  tickets: KpiDashboardTicket[];
  buildExportUrl: (from: string, to: string) => string;
  getPriorityBadge: (priority: string) => React.ReactNode;
  getStatusDot: (status: string) => React.ReactNode;
  getStatusText: (status: string) => string;
}

const PRESET_LABEL: Record<DatePreset, string> = {
  today: 'Hoje',
  '7d': '7 dias',
  '30d': '30 dias',
  '90d': '90 dias',
  custom: 'Personalizado',
};

const CATEGORY_COLORS = ['#6366f1', '#8b5cf6', '#10b981', '#f59e0b', '#6b7280'];

function isoDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function effectiveRange(
  preset: DatePreset,
  customFrom: string,
  customTo: string
): { from: string; to: string } {
  const now = new Date();
  const todayStr = isoDateLocal(now);

  switch (preset) {
    case 'today':
      return { from: todayStr, to: todayStr };
    case '7d': {
      const from = new Date(now);
      from.setDate(from.getDate() - 6);
      return { from: isoDateLocal(from), to: todayStr };
    }
    case '30d': {
      const from = new Date(now);
      from.setDate(from.getDate() - 29);
      return { from: isoDateLocal(from), to: todayStr };
    }
    case '90d': {
      const from = new Date(now);
      from.setDate(from.getDate() - 89);
      return { from: isoDateLocal(from), to: todayStr };
    }
    case 'custom':
      return { from: customFrom, to: customTo };
    default: {
      const _exhaustive: never = preset;
      void _exhaustive;
      return { from: todayStr, to: todayStr };
    }
  }
}

function filterByCreatedAt(
  tickets: KpiDashboardTicket[],
  from: string,
  to: string
): KpiDashboardTicket[] {
  if (!from && !to) return tickets;
  return tickets.filter((t) => {
    const created = new Date(t.createdAt);
    if (Number.isNaN(created.getTime())) return false;
    if (from) {
      const fromDt = new Date(from + 'T00:00:00');
      if (created < fromDt) return false;
    }
    if (to) {
      const toDt = new Date(to + 'T23:59:59.999');
      if (created > toDt) return false;
    }
    return true;
  });
}

function toInput(t: KpiDashboardTicket): KpiTicketInput {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    category: t.category,
    source: t.source,
    createdAt: t.createdAt,
    resolvedAt: t.resolvedAt,
    createdById: t.createdById,
    assignedToId: t.assignedToId,
    assignee: t.assignee,
    creator: t.creator,
    messages: t.messages,
  };
}

function TrendChip({
  value,
  invertGood,
  suffix = '',
}: {
  value: number | null | undefined;
  invertGood?: boolean;
  suffix?: string;
}) {
  if (value == null || Number.isNaN(value) || Math.abs(value) < 0.05) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-500">
        <Minus className="h-3 w-3" /> vs período ant.
      </span>
    );
  }
  const good = invertGood ? value < 0 : value > 0;
  const Icon = value > 0 ? TrendingUp : TrendingDown;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${
        good ? 'text-emerald-400' : 'text-red-400'
      }`}
    >
      <Icon className="h-3 w-3" />
      {value > 0 ? '+' : ''}
      {value.toFixed(1)}
      {suffix} vs ant.
    </span>
  );
}

function HelpTip({ text }: { text: string }) {
  return (
    <span className="relative group/help inline-flex align-middle ml-1">
      <HelpCircle className="h-3 w-3 text-slate-500 cursor-help" />
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-64 z-20 rounded-lg bg-slate-900 border border-white/10 px-3 py-2 text-[10px] leading-relaxed text-slate-300 opacity-0 group-hover/help:opacity-100 transition-opacity shadow-xl">
        {text}
      </span>
    </span>
  );
}

function KpiCard({
  label,
  value,
  hint,
  help,
  valueClass,
  trend,
  pulse,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  help?: string;
  valueClass?: string;
  trend?: React.ReactNode;
  pulse?: boolean;
}) {
  return (
    <div className="glass-card rounded-2xl p-5 border border-white/5 text-left space-y-1 relative overflow-hidden">
      {pulse && (
        <div className="absolute top-2 right-2 h-2 w-2 bg-red-500 pulse-indicator rounded-full" />
      )}
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center">
        {label}
        {help ? <HelpTip text={help} /> : null}
      </p>
      <p className={`text-3xl font-extrabold ${valueClass || 'text-white'}`}>{value}</p>
      {hint ? <p className="text-[10px] text-slate-400">{hint}</p> : null}
      {trend}
    </div>
  );
}

export function KpiDashboard({
  tickets,
  buildExportUrl,
  getPriorityBadge,
  getStatusDot,
  getStatusText,
}: KpiDashboardProps) {
  const [kpiPreset, setKpiPreset] = useState<DatePreset>('30d');
  const [kpiDateFrom, setKpiDateFrom] = useState('');
  const [kpiDateTo, setKpiDateTo] = useState('');

  const range = useMemo(
    () => effectiveRange(kpiPreset, kpiDateFrom, kpiDateTo),
    [kpiPreset, kpiDateFrom, kpiDateTo]
  );

  const periodTickets = useMemo(
    () => filterByCreatedAt(tickets, range.from, range.to),
    [tickets, range]
  );

  const report = useMemo(
    () => computeKpiReport(periodTickets.map(toInput)),
    [periodTickets]
  );

  const trend = useMemo(() => {
    if (!range.from || !range.to) return null;
    const prev = previousPeriodRange(range.from, range.to);
    if (!prev) return null;
    const prevTickets = filterByCreatedAt(tickets, prev.from, prev.to);
    const prevSummary = computeKpiReport(prevTickets.map(toInput)).summary;
    return computeTrendDelta(report.summary, prevSummary);
  }, [tickets, range, report.summary]);

  const { summary, breakdowns } = report;
  const totalCatSum = breakdowns.byCategory.reduce((a, b) => a + b.count, 0);
  const maxStatus = Math.max(...breakdowns.byStatus.map((s) => s.count), 1);
  const maxDaily = Math.max(...breakdowns.dailyVolume.map((d) => d.created), 1);

  const complianceClass =
    summary.slaCompliancePct == null
      ? 'text-slate-400'
      : summary.slaCompliancePct >= 90
        ? 'text-emerald-400'
        : summary.slaCompliancePct >= 70
          ? 'text-amber-400'
          : 'text-red-400';

  const resolutionClass =
    summary.resolutionRate >= 80
      ? 'text-emerald-400'
      : summary.resolutionRate >= 50
        ? 'text-amber-400'
        : 'text-red-400';

  return (
    <div className="flex-1 flex flex-col p-6 overflow-y-auto text-left max-w-6xl mx-auto w-full space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 border-b border-white/5 pb-5">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-indigo-500" /> Relatórios de Suporte e KPIs
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Totais unificados do setor (iguais para Admin e Técnico). Filtre por período e exporte em
            Excel.
          </p>
        </div>
        <a
          href={buildExportUrl(range.from, range.to)}
          download
          className="flex items-center gap-2 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-xs transition-all cursor-pointer shadow-lg shadow-emerald-600/15 whitespace-nowrap shrink-0"
        >
          <FileSpreadsheet className="h-4 w-4" />
          Exportar Excel com Filtro
        </a>
      </div>

      {/* Period filter */}
      <div className="glass-card rounded-2xl p-4 border border-white/5 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
          <Calendar className="h-4 w-4 text-indigo-400" />
          Período:
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(['today', '7d', '30d', '90d', 'custom'] as DatePreset[]).map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setKpiPreset(preset)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer border ${
                kpiPreset === preset
                  ? 'bg-indigo-600 border-indigo-500 text-white shadow-sm'
                  : 'bg-slate-950 border-white/5 text-slate-400 hover:text-slate-200 hover:border-white/10'
              }`}
            >
              {PRESET_LABEL[preset]}
            </button>
          ))}
        </div>

        {kpiPreset === 'custom' && (
          <div className="flex items-center gap-2 ml-1">
            <input
              type="date"
              value={kpiDateFrom}
              onChange={(e) => setKpiDateFrom(e.target.value)}
              className="px-3 py-1.5 bg-slate-950 border border-white/5 rounded-lg text-white text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <span className="text-slate-500 text-xs">até</span>
            <input
              type="date"
              value={kpiDateTo}
              onChange={(e) => setKpiDateTo(e.target.value)}
              className="px-3 py-1.5 bg-slate-950 border border-white/5 rounded-lg text-white text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        )}

        <span className="ml-auto text-[10px] text-slate-500 font-semibold">
          {summary.total} ticket(s) · {range.from || '…'} → {range.to || '…'}
        </span>
      </div>

      {/* Policy strip */}
      <div className="rounded-xl border border-indigo-500/15 bg-indigo-500/5 px-4 py-3 text-[11px] text-slate-400 leading-relaxed">
        <span className="font-semibold text-indigo-300">Metas SLA: </span>
        Urgente/Alta 2h · Média 24h · Baixa 72h (tempo corrido). Compliance exclui tickets ainda no
        prazo. MTTR usa apenas resolvidos/fechados com <code className="text-slate-300">resolvedAt</code>.
      </div>

      {/* Primary KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Total de Tickets"
          value={summary.total}
          hint={`${summary.open} aberto(s) · ${summary.inProgress} em andamento`}
          trend={<TrendChip value={trend?.totalDelta ?? null} />}
        />
        <KpiCard
          label="Taxa de Resolução"
          value={`${summary.resolutionRate.toFixed(0)}%`}
          valueClass={resolutionClass}
          hint={`${summary.resolved} resolvido(s)/fechado(s)`}
          trend={<TrendChip value={trend?.resolutionRateDelta ?? null} suffix="pp" />}
        />
        <KpiCard
          label="MTTR"
          value={formatDurationHours(summary.mttrHours)}
          valueClass="text-indigo-400"
          hint={
            summary.mttrSampleSize > 0
              ? `Média de ${summary.mttrSampleSize} resolução(ões)`
              : 'Sem resoluções com data no período'
          }
          help={MTTR_HELP}
          trend={<TrendChip value={trend?.mttrHoursDelta ?? null} invertGood suffix="h" />}
        />
        <KpiCard
          label="Compliance SLA"
          value={
            summary.slaCompliancePct != null
              ? `${summary.slaCompliancePct.toFixed(0)}%`
              : '—'
          }
          valueClass={complianceClass}
          hint={`${summary.slaMet} cumprido(s) · ${summary.slaBreached} estouro(s)`}
          help={SLA_POLICY_HELP}
          trend={<TrendChip value={trend?.slaComplianceDelta ?? null} suffix="pp" />}
        />
      </div>

      {/* Secondary KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Estouros abertos"
          value={summary.openSlaBreaches}
          valueClass={summary.openSlaBreaches > 0 ? 'text-red-400' : 'text-white'}
          hint="Backlog atualmente fora da meta"
          pulse={summary.openSlaBreaches > 0}
        />
        <KpiCard
          label="Backlog"
          value={summary.backlog}
          hint={`${summary.pending} pendente(s) · ${summary.urgentOpen} urgente(s)`}
        />
        <KpiCard
          label="MTTFR"
          value={formatDurationHours(summary.mttfrHours)}
          valueClass="text-sky-400"
          hint={
            summary.mttfrSampleSize > 0
              ? `Amostra: ${summary.mttfrSampleSize} ticket(s)`
              : 'Sem 1ª resposta de agente no período'
          }
          help={MTTFR_HELP}
        />
        <KpiCard
          label="SLA no prazo"
          value={summary.slaWithin}
          hint="Abertos ainda dentro da meta (fora da compliance)"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Categories pie */}
        <div className="glass-card rounded-2xl p-6 border border-white/5 text-left flex flex-col h-[360px]">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-4">
            Volume por Categoria
          </h3>
          <div className="flex-1 flex items-center justify-center relative">
            {totalCatSum === 0 ? (
              <EmptyChart />
            ) : (
              <svg width="200" height="200" viewBox="-100 -100 200 200" className="transform -rotate-90">
                {(() => {
                  let cumulativeAngle = 0;
                  return breakdowns.byCategory.map((row, i) => {
                    if (row.count === 0) return null;
                    const percentage = row.count / totalCatSum;
                    const angle = percentage * 360;
                    const startAngle = cumulativeAngle;
                    cumulativeAngle += angle;
                    const rad = Math.PI / 180;
                    const x1 = 85 * Math.cos(startAngle * rad);
                    const y1 = 85 * Math.sin(startAngle * rad);
                    const x2 = 85 * Math.cos(cumulativeAngle * rad);
                    const y2 = 85 * Math.sin(cumulativeAngle * rad);
                    const largeArc = angle > 180 ? 1 : 0;
                    return (
                      <path
                        key={row.key}
                        d={`M 0 0 L ${x1} ${y1} A 85 85 0 ${largeArc} 1 ${x2} ${y2} Z`}
                        fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]}
                        stroke="#030712"
                        strokeWidth="2.5"
                        className="transition-all duration-300 hover:opacity-90"
                      />
                    );
                  });
                })()}
                <circle r="48" fill="#030712" />
              </svg>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-white/5 text-[10px] text-slate-400 font-semibold">
            {breakdowns.byCategory.map((row, i) => (
              <div key={row.key} className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }}
                />
                {row.label} ({row.count})
              </div>
            ))}
          </div>
        </div>

        {/* Status bars */}
        <div className="glass-card rounded-2xl p-6 border border-white/5 text-left flex flex-col h-[360px]">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-4">
            Volume por Status
          </h3>
          <div className="flex-1 flex flex-col justify-center space-y-3 px-2">
            {breakdowns.byStatus.map((row) => {
              const pct = (row.count / maxStatus) * 100;
              const colorMap: Record<string, string> = {
                OPEN: 'from-sky-500 to-indigo-500',
                IN_PROGRESS: 'from-yellow-500 to-amber-500',
                PENDING: 'from-orange-500 to-amber-600',
                RESOLVED: 'from-emerald-500 to-teal-500',
                CLOSED: 'from-slate-500 to-gray-500',
              };
              return (
                <div key={row.key} className="space-y-1.5">
                  <div className="flex justify-between text-[11px] font-bold text-slate-300">
                    <span className="flex items-center gap-1.5">
                      {getStatusDot(row.key)} {STATUS_LABEL_PT[row.key] || row.label}
                    </span>
                    <span>
                      {row.count} (
                      {summary.total > 0 ? ((row.count / summary.total) * 100).toFixed(0) : 0}%)
                    </span>
                  </div>
                  <div className="h-3 w-full bg-slate-950 border border-white/5 rounded-full overflow-hidden">
                    <div
                      className={`h-full bg-gradient-to-r ${colorMap[row.key] || 'from-indigo-600 to-violet-600'} rounded-full transition-all duration-700`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 pt-4 border-t border-white/5">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
              Por Canal de Origem
            </p>
            <div className="flex gap-3">
              {breakdowns.bySource.map((row) => (
                <div key={row.key} className="flex-1 text-center">
                  <p className="text-lg font-extrabold text-white">{row.count}</p>
                  <p className="text-[10px] text-slate-500">{row.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* SLA + Priority + Daily */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="glass-card rounded-2xl p-6 border border-white/5 space-y-4">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-400" /> SLA: met vs estourado
          </h3>
          {breakdowns.bySla.map((row) => {
            const totalSla = (summary.slaMet + summary.slaBreached + summary.slaWithin) || 1;
            const pct = (row.count / totalSla) * 100;
            const color =
              row.key === 'met'
                ? 'bg-emerald-500'
                : row.key === 'breached'
                  ? 'bg-red-500'
                  : 'bg-sky-500';
            return (
              <div key={row.key} className="space-y-1.5">
                <div className="flex justify-between text-[11px] font-semibold text-slate-300">
                  <span>{row.label}</span>
                  <span>
                    {row.count} ({pct.toFixed(0)}%)
                  </span>
                </div>
                <div className="h-2.5 w-full bg-slate-950 border border-white/5 rounded-full overflow-hidden">
                  <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>

        <div className="glass-card rounded-2xl p-6 border border-white/5 space-y-3">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
            Por Prioridade (meta SLA)
          </h3>
          {breakdowns.byPriority.map((row) => (
            <div
              key={row.key}
              className="flex items-center justify-between text-[11px] border-b border-white/5 pb-2 last:border-0"
            >
              <span className="flex items-center gap-2 text-slate-300 font-semibold">
                {PRIORITY_LABEL_PT[row.key] || row.label}
                <span className="text-[10px] text-slate-500 font-normal">
                  meta {getSlaTargetLabel(row.key)}
                </span>
              </span>
              <span className="text-white font-bold">{row.count}</span>
            </div>
          ))}
        </div>

        <div className="glass-card rounded-2xl p-6 border border-white/5 space-y-3">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <Clock className="h-4 w-4 text-indigo-400" /> Volume diário
          </h3>
          {breakdowns.dailyVolume.length === 0 ? (
            <p className="text-[11px] text-slate-500">Sem dados no período</p>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {breakdowns.dailyVolume.slice(-14).map((row) => (
                <div key={row.day} className="space-y-1">
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>{row.day}</span>
                    <span>
                      {row.created} criados · {row.resolved} resolvidos
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-slate-950 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500/80 rounded-full"
                      style={{ width: `${(row.created / maxDaily) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Technician breakdown */}
      <div className="glass-card rounded-2xl border border-white/5 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" /> Desempenho por Técnico
          </h3>
          <span className="text-[10px] text-slate-500">
            {breakdowns.byTechnician.length} linha(s)
          </span>
        </div>
        {breakdowns.byTechnician.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs">
            <Inbox className="h-8 w-8 mx-auto mb-2 opacity-40" />
            Sem tickets no período
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/5 bg-slate-950/40">
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase">
                    Técnico
                  </th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase">
                    Atribuídos
                  </th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase">
                    Resolvidos
                  </th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase">
                    Abertos
                  </th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase">
                    MTTR
                  </th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase">
                    SLA %
                  </th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase">
                    Estouros
                  </th>
                </tr>
              </thead>
              <tbody>
                {breakdowns.byTechnician.map((row, i) => (
                  <tr
                    key={row.key}
                    className={`border-b border-white/5 hover:bg-white/[0.02] ${
                      i % 2 === 0 ? '' : 'bg-white/[0.01]'
                    }`}
                  >
                    <td className="px-4 py-2.5 text-slate-200 font-medium">{row.name}</td>
                    <td className="px-4 py-2.5 text-right text-slate-300">{row.assigned}</td>
                    <td className="px-4 py-2.5 text-right text-emerald-400/90">{row.resolved}</td>
                    <td className="px-4 py-2.5 text-right text-slate-400">{row.open}</td>
                    <td className="px-4 py-2.5 text-right text-indigo-300">
                      {formatDurationHours(row.mttrHours)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-200">
                      {row.slaCompliancePct != null
                        ? `${row.slaCompliancePct.toFixed(0)}%`
                        : '—'}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right font-semibold ${
                        row.slaBreached > 0 ? 'text-red-400' : 'text-slate-500'
                      }`}
                    >
                      {row.slaBreached}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent tickets with SLA */}
      {periodTickets.length > 0 && (
        <div className="glass-card rounded-2xl border border-white/5 overflow-hidden">
          <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
              Tickets Recentes no Período
            </h3>
            <span className="text-[10px] text-slate-500">
              {Math.min(periodTickets.length, 12)} de {periodTickets.length}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/5 bg-slate-950/40">
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase">
                    Título
                  </th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase">
                    Categoria
                  </th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase">
                    Prioridade
                  </th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase">
                    Status
                  </th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase">
                    SLA
                  </th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase">
                    Técnico
                  </th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase">
                    Abertura
                  </th>
                </tr>
              </thead>
              <tbody>
                {periodTickets.slice(0, 12).map((t, i) => {
                  const sla = evaluateSla(toInput(t));
                  const slaLabel =
                    sla === 'met'
                      ? 'Cumprido'
                      : sla === 'breached'
                        ? 'Estourado'
                        : sla === 'within'
                          ? 'No prazo'
                          : '—';
                  const slaClass =
                    sla === 'met'
                      ? 'text-emerald-400'
                      : sla === 'breached'
                        ? 'text-red-400'
                        : 'text-sky-400';
                  return (
                    <tr
                      key={t.id}
                      className={`border-b border-white/5 hover:bg-white/[0.02] transition-colors ${
                        i % 2 === 0 ? '' : 'bg-white/[0.01]'
                      }`}
                    >
                      <td className="px-4 py-2.5 text-slate-200 font-medium max-w-[200px] truncate">
                        {t.title}
                      </td>
                      <td className="px-4 py-2.5 text-slate-400">{t.category}</td>
                      <td className="px-4 py-2.5">{getPriorityBadge(t.priority)}</td>
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-1.5">
                          {getStatusDot(t.status)}
                          {getStatusText(t.status)}
                        </span>
                      </td>
                      <td className={`px-4 py-2.5 font-semibold ${slaClass}`}>
                        {slaLabel}
                        <span className="block text-[9px] text-slate-500 font-normal">
                          meta {getSlaTargetLabel(t.priority)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-400">
                        {t.assignee?.name || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 text-[10px]">
                        {new Date(t.createdAt).toLocaleDateString('pt-BR', {
                          timeZone: 'America/Fortaleza',
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="text-center text-slate-600 text-xs">
      <BarChart3 className="h-10 w-10 mx-auto mb-2 opacity-30" />
      Sem dados no período
    </div>
  );
}
