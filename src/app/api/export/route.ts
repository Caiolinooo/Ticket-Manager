import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { canAccessOperatorArea } from '@/lib/permissions';
import * as XLSX from 'xlsx';
import {
  computeKpiReport,
  evaluateSla,
  formatDurationHours,
  getSlaTargetLabel,
  PRIORITY_LABEL_PT,
  SOURCE_LABEL_PT,
  STATUS_LABEL_PT,
  resolutionDurationMs,
  type KpiTicketInput,
  type MonthlyCategoryMatrix,
} from '@/lib/kpi-metrics';

// Priority labels PT-BR
const PRIORITY_LABEL: Record<string, string> = {
  ...PRIORITY_LABEL_PT,
};

// Status labels PT-BR
const STATUS_LABEL: Record<string, string> = {
  ...STATUS_LABEL_PT,
};

// Source labels PT-BR
const SOURCE_LABEL: Record<string, string> = {
  ...SOURCE_LABEL_PT,
  PORTAL: 'Portal do Cliente',
  TEAMS: 'Microsoft Teams',
  EMAIL: 'E-mail (Exchange)',
  PHONE: 'Telefone',
  MANUAL: 'Abertura Manual',
};

const SLA_OUTCOME_LABEL: Record<string, string> = {
  met: 'Cumprido',
  breached: 'Estourado',
  within: 'No prazo',
};

// Brand colors
const BRAND_NAVY = '1E3A5F';
const BRAND_INDIGO = '4F46E5';
const BRAND_EMERALD = '059669';
const BRAND_AMBER = 'D97706';
const BRAND_RED = 'DC2626';
const COLOR_WHITE = 'FFFFFF';
const COLOR_LIGHT_BLUE = 'EFF6FF';
const COLOR_LIGHT_GREEN = 'ECFDF5';
const COLOR_LIGHT_AMBER = 'FFFBEB';
const COLOR_LIGHT_RED = 'FEF2F2';

export async function GET(request: Request) {
  try {
    const session = await getSession();

    if (!canAccessOperatorArea(session)) {
      return new Response('Acesso negado', { status: 403 });
    }

    // Parse optional date filters from query params
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');

    // Build Prisma date filter
    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (dateFrom) {
      dateFilter.gte = new Date(dateFrom + 'T00:00:00Z');
    }
    if (dateTo) {
      dateFilter.lte = new Date(dateTo + 'T23:59:59Z');
    }

    // Fetch ALL sector tickets (unified KPIs) — date filter only, never by technician mailbox
    const tickets = await prisma.ticket.findMany({
      where: Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : undefined,
      include: {
        creator: true,
        assignee: true,
        externalTraces: true,
        messages: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Period label for filename and headers
    const periodLabel = dateFrom && dateTo
      ? `${dateFrom.replace(/-/g, '/')} a ${dateTo.replace(/-/g, '/')}`
      : 'Todos os Registros';

    const kpiInputs: KpiTicketInput[] = tickets.map((t) => ({
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
    }));

    const report = computeKpiReport(kpiInputs, Date.now(), { from: dateFrom, to: dateTo });
    const { summary, breakdowns } = report;

    // ── SHEET 1: Relatório Completo ──────────────────────────────────────────
    const reportRows = tickets.map((t, index) => {
      const createdDate = new Date(t.createdAt);
      const resolvedDate = t.resolvedAt ? new Date(t.resolvedAt) : null;
      const durationMs = resolutionDurationMs(kpiInputs[index]);
      const sla = evaluateSla(kpiInputs[index]);

      return {
        'Nº': index + 1,
        'ID do Ticket': t.id,
        'Título': t.title,
        'Descrição': t.description.substring(0, 200) + (t.description.length > 200 ? '...' : ''),
        'Categoria': t.category,
        'Prioridade': PRIORITY_LABEL[t.priority] || t.priority,
        'Meta SLA': getSlaTargetLabel(t.priority),
        'Status SLA': sla ? SLA_OUTCOME_LABEL[sla] : '—',
        'Status': STATUS_LABEL[t.status] || t.status,
        'Origem': SOURCE_LABEL[t.source] || t.source,
        'ID Ref. Externo': t.externalReferenceId || '—',
        'Solicitante': t.creator.name,
        'E-mail Solicitante': t.creator.email,
        'Técnico Responsável': t.assignee?.name || 'Não Atribuído',
        'E-mail Técnico': t.assignee?.email || '—',
        'Data de Abertura': createdDate.toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' }),
        'Data de Resolução': resolvedDate
          ? resolvedDate.toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' })
          : 'Pendente',
        'Tempo de Resolução (h)':
          durationMs != null ? (durationMs / (1000 * 60 * 60)).toFixed(2) : '—',
        'Solução / Resolução': t.resolution || '—',
        'Qtd. Mensagens': t.messages?.length ?? 0,
      };
    });

    // ── SHEET 2: Resumo Executivo ────────────────────────────────────────────
    const summaryRows = [
      { 'Indicador': '📋 PERÍODO ANALISADO', 'Valor': periodLabel },
      { 'Indicador': '', 'Valor': '' },
      { 'Indicador': '📊 TOTAL DE CHAMADOS', 'Valor': summary.total },
      { 'Indicador': '✅ Resolvidos / Fechados', 'Valor': summary.resolved },
      { 'Indicador': '🔄 Em Andamento', 'Valor': summary.inProgress },
      { 'Indicador': '⏳ Pendentes', 'Valor': summary.pending },
      { 'Indicador': '🔴 Em Aberto', 'Valor': summary.open },
      { 'Indicador': '📦 Backlog (aberto+andamento+pendente)', 'Valor': summary.backlog },
      { 'Indicador': '🚨 Urgentes abertos', 'Valor': summary.urgentOpen },
      { 'Indicador': '⚠️ Alta prioridade abertos', 'Valor': summary.highOpen },
      { 'Indicador': '📈 Taxa de Resolução', 'Valor': `${summary.resolutionRate.toFixed(1)}%` },
      {
        'Indicador': '⏱️ MTTR (tempo médio de resolução)',
        'Valor': formatDurationHours(summary.mttrHours),
      },
      {
        'Indicador': '💬 MTTFR (tempo médio 1ª resposta)',
        'Valor': formatDurationHours(summary.mttfrHours),
      },
      {
        'Indicador': '✅ Compliance SLA',
        'Valor':
          summary.slaCompliancePct != null
            ? `${summary.slaCompliancePct.toFixed(1)}%`
            : '—',
      },
      { 'Indicador': '🟢 SLA cumpridos', 'Valor': summary.slaMet },
      { 'Indicador': '🚫 SLA estourados (total)', 'Valor': summary.slaBreached },
      { 'Indicador': '⏳ SLA ainda no prazo', 'Valor': summary.slaWithin },
      { 'Indicador': '🔴 Estouros abertos agora', 'Valor': summary.openSlaBreaches },
      { 'Indicador': '', 'Valor': '' },
      { 'Indicador': '── POR MÊS × CATEGORIA (SGI) ──', 'Valor': '' },
      ...sgiSummaryRows(breakdowns.monthlyByCategory),
      { 'Indicador': '', 'Valor': '' },
      { 'Indicador': '── POR CATEGORIA ──', 'Valor': '' },
      ...breakdowns.byCategory.map((row) => ({
        'Indicador': `  ${row.label}`,
        'Valor': row.count,
      })),
      { 'Indicador': '', 'Valor': '' },
      { 'Indicador': '── POR CANAL DE ORIGEM ──', 'Valor': '' },
      ...breakdowns.bySource.map((row) => ({
        'Indicador': `  ${SOURCE_LABEL[row.key] || row.label}`,
        'Valor': row.count,
      })),
      { 'Indicador': '', 'Valor': '' },
      { 'Indicador': '── POR PRIORIDADE ──', 'Valor': '' },
      ...breakdowns.byPriority.map((row) => ({
        'Indicador': `  ${row.label}`,
        'Valor': row.count,
      })),
    ];

    // ── SHEET 3: KPIs do Período ────────────────────────────────────────────
    const kpiRows = [
      { 'KPI': '▶ INDICADORES CHAVE DE DESEMPENHO (KPI)', 'Valor': '', 'Contexto': `Período: ${periodLabel}` },
      { 'KPI': '', 'Valor': '', 'Contexto': '' },
      { 'KPI': '📊 Volume Total de Chamados', 'Valor': summary.total, 'Contexto': 'Total no período' },
      { 'KPI': '🟢 Resolvidos / Fechados', 'Valor': summary.resolved, 'Contexto': '' },
      { 'KPI': '🔵 Em Andamento', 'Valor': summary.inProgress, 'Contexto': '' },
      { 'KPI': '🟡 Pendentes', 'Valor': summary.pending, 'Contexto': '' },
      { 'KPI': '🔴 Em Aberto', 'Valor': summary.open, 'Contexto': '' },
      { 'KPI': '📦 Backlog', 'Valor': summary.backlog, 'Contexto': 'Aberto + Andamento + Pendente' },
      { 'KPI': '', 'Valor': '', 'Contexto': '' },
      {
        'KPI': '📈 Taxa de Resolução',
        'Valor': `${summary.resolutionRate.toFixed(1)}%`,
        'Contexto': 'Resolvidos ÷ Total',
      },
      {
        'KPI': '⏱️ MTTR (Mean Time To Resolve)',
        'Valor': formatDurationHours(summary.mttrHours),
        'Contexto': `Amostra: ${summary.mttrSampleSize} · ${report.definitions.mttr}`,
      },
      {
        'KPI': '💬 MTTFR (1ª resposta)',
        'Valor': formatDurationHours(summary.mttfrHours),
        'Contexto': `Amostra: ${summary.mttfrSampleSize}`,
      },
      {
        'KPI': '✅ Compliance SLA',
        'Valor':
          summary.slaCompliancePct != null
            ? `${summary.slaCompliancePct.toFixed(1)}%`
            : '—',
        'Contexto': report.definitions.sla,
      },
      { 'KPI': '🟢 SLA cumpridos', 'Valor': summary.slaMet, 'Contexto': '' },
      { 'KPI': '🚫 SLA estourados', 'Valor': summary.slaBreached, 'Contexto': 'Abertos ou resolvidos após a meta' },
      { 'KPI': '⏳ SLA no prazo (ainda abertos)', 'Valor': summary.slaWithin, 'Contexto': 'Excluídos do denominador da compliance' },
      { 'KPI': '🔴 Estouros abertos agora', 'Valor': summary.openSlaBreaches, 'Contexto': 'Backlog fora da meta' },
      { 'KPI': '', 'Valor': '', 'Contexto': '' },
      { 'KPI': '▶ DISTRIBUIÇÃO POR PRIORIDADE', 'Valor': '', 'Contexto': '' },
      ...breakdowns.byPriority.map((row) => ({
        'KPI': `  ${row.label}`,
        'Valor': row.count,
        'Contexto':
          summary.total > 0
            ? `${((row.count / summary.total) * 100).toFixed(1)}% · meta ${getSlaTargetLabel(row.key)}`
            : '0.0%',
      })),
      { 'KPI': '', 'Valor': '', 'Contexto': '' },
      { 'KPI': '▶ ATENDIMENTOS POR MÊS E CATEGORIA', 'Valor': '', 'Contexto': 'Indicadores – SGI' },
      ...breakdowns.monthlyByCategory.months.map((row) => ({
        'KPI': `  ${row.label}`,
        'Valor': row.total,
        'Contexto': breakdowns.monthlyByCategory.categories
          .map((cat) => `${cat}: ${row.counts[cat] ?? 0}`)
          .join(' · '),
      })),
      { 'KPI': '', 'Valor': '', 'Contexto': '' },
      { 'KPI': '▶ DISTRIBUIÇÃO POR CATEGORIA', 'Valor': '', 'Contexto': '' },
      ...breakdowns.byCategory.map((row) => ({
        'KPI': `  ${row.label}`,
        'Valor': row.count,
        'Contexto':
          summary.total > 0 ? `${((row.count / summary.total) * 100).toFixed(1)}%` : '0.0%',
      })),
      { 'KPI': '', 'Valor': '', 'Contexto': '' },
      { 'KPI': '▶ DISTRIBUIÇÃO POR CANAL DE ORIGEM', 'Valor': '', 'Contexto': '' },
      ...breakdowns.bySource.map((row) => ({
        'KPI': `  ${SOURCE_LABEL[row.key] || row.label}`,
        'Valor': row.count,
        'Contexto':
          summary.total > 0 ? `${((row.count / summary.total) * 100).toFixed(1)}%` : '0.0%',
      })),
      { 'KPI': '', 'Valor': '', 'Contexto': '' },
      { 'KPI': '▶ VOLUME DIÁRIO', 'Valor': '', 'Contexto': 'Criados / Resolvidos' },
      ...breakdowns.dailyVolume.map((row) => ({
        'KPI': `  ${row.day}`,
        'Valor': `${row.created} criados`,
        'Contexto': `${row.resolved} resolvidos`,
      })),
      { 'KPI': '', 'Valor': '', 'Contexto': '' },
      { 'KPI': '▶ DESEMPENHO POR TÉCNICO', 'Valor': '', 'Contexto': '' },
      ...breakdowns.byTechnician.map((row) => ({
        'KPI': `  ${row.name}`,
        'Valor': `${row.assigned} atribuídos / ${row.resolved} resolvidos`,
        'Contexto': [
          row.mttrHours != null ? `MTTR ${formatDurationHours(row.mttrHours)}` : null,
          row.slaCompliancePct != null
            ? `SLA ${row.slaCompliancePct.toFixed(0)}%`
            : null,
          `${row.slaBreached} estouro(s)`,
        ]
          .filter(Boolean)
          .join(' · '),
      })),
    ];

    // ── Build Workbook ───────────────────────────────────────────────────────
    const wb = XLSX.utils.book_new();

    // Sheet 1: Full Report
    if (reportRows.length > 0) {
      const wsReport = XLSX.utils.json_to_sheet(reportRows);
      autoFitColumns(wsReport, reportRows);
      styleHeaderRow(wsReport, Object.keys(reportRows[0] || {}), BRAND_NAVY);
      XLSX.utils.book_append_sheet(wb, wsReport, 'Chamados');
    } else {
      const wsEmpty = XLSX.utils.aoa_to_sheet([['Nenhum chamado encontrado no período selecionado.']]);
      XLSX.utils.book_append_sheet(wb, wsEmpty, 'Chamados');
    }

    const wsSgi = buildSgiWorksheet(breakdowns.monthlyByCategory);
    XLSX.utils.book_append_sheet(wb, wsSgi, 'Indicadores SGI');

    // Sheet 2: Executive Summary
    const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
    autoFitColumns(wsSummary, summaryRows);
    styleHeaderRow(wsSummary, Object.keys(summaryRows[0] || {}), BRAND_INDIGO);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumo Executivo');

    // Sheet 3: KPIs
    const wsKpi = XLSX.utils.json_to_sheet(kpiRows);
    autoFitColumns(wsKpi, kpiRows);
    styleHeaderRow(wsKpi, Object.keys(kpiRows[0] || {}), BRAND_EMERALD);
    styleKpiHighlightRows(wsKpi, kpiRows);
    XLSX.utils.book_append_sheet(wb, wsKpi, 'KPIs do Período');

    // Filename with date range and current date
    const today = new Date()
      .toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' })
      .replace(/\//g, '-');
    const periodSuffix =
      dateFrom && dateTo
        ? `_${dateFrom.replace(/-/g, '')}_a_${dateTo.replace(/-/g, '')}`
        : '';
    const filename = `TicketManager_Chamados${periodSuffix}_${today}.xlsx`;

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    return new Response(buf, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error: any) {
    console.error('Export Excel error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

function sgiSummaryRows(matrix: MonthlyCategoryMatrix): { Indicador: string; Valor: string | number }[] {
  if (matrix.months.length === 0) {
    return [{ Indicador: '  Sem atendimentos no período', Valor: 0 }];
  }
  return matrix.months.map((row) => ({
    Indicador: `  ${row.label}`,
    Valor: matrix.categories.map((cat) => `${cat}: ${row.counts[cat] ?? 0}`).join(' | ') + ` | Total: ${row.total}`,
  }));
}

function buildSgiWorksheet(matrix: MonthlyCategoryMatrix): XLSX.WorkSheet {
  const header = ['Ref.', ...matrix.categories, 'Total'];
  const aoa: (string | number)[][] = [
    [matrix.title],
    header,
    ...matrix.months.map((m) => [
      m.label,
      ...matrix.categories.map((c) => m.counts[c] ?? 0),
      m.total,
    ]),
  ];
  if (matrix.months.length === 0) {
    aoa.push(['—', ...matrix.categories.map(() => 0), 0]);
  }
  aoa.push([]);
  aoa.push(['AN-QUA-007-RO | MN-QUA-R17']);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const lastCol = header.length - 1;
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } }];
  ws['!cols'] = header.map((h, i) => ({ wch: i === 0 ? 14 : Math.min(Math.max(h.length + 2, 10), 36) }));

  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  const dataEndRow = 1 + Math.max(matrix.months.length, 1);

  for (let col = 0; col <= lastCol; col++) {
    const titleCell = XLSX.utils.encode_cell({ r: 0, c: col });
    if (!ws[titleCell]) ws[titleCell] = { t: 's', v: col === 0 ? matrix.title : '' };
    ws[titleCell].s = {
      font: { bold: true, color: { rgb: COLOR_WHITE }, sz: 14 },
      fill: { fgColor: { rgb: BRAND_NAVY } },
      alignment: { horizontal: 'center', vertical: 'center' },
    };
    const headerCell = XLSX.utils.encode_cell({ r: 1, c: col });
    if (ws[headerCell]) {
      ws[headerCell].s = {
        font: { bold: true, color: { rgb: COLOR_WHITE }, sz: 10 },
        fill: { fgColor: { rgb: BRAND_NAVY } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      };
    }
  }

  for (let row = 2; row <= dataEndRow; row++) {
    for (let col = 0; col <= lastCol; col++) {
      const addr = XLSX.utils.encode_cell({ r: row, c: col });
      if (!ws[addr]) continue;
      const isRef = col === 0;
      ws[addr].s = {
        font: { bold: true, color: { rgb: isRef ? COLOR_WHITE : '111827' }, sz: 11 },
        fill: { fgColor: { rgb: isRef ? BRAND_NAVY : 'E5E7EB' } },
        alignment: { horizontal: 'center', vertical: 'center' },
      };
    }
  }

  void range;
  return ws;
}

/** Auto-fit column widths based on content length */
function autoFitColumns(ws: XLSX.WorkSheet, rows: Record<string, any>[]) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  ws['!cols'] = keys.map(key => {
    let maxLen = key.length;
    for (const row of rows) {
      const val = String(row[key] ?? '');
      if (val.length > maxLen) maxLen = val.length;
    }
    return { wch: Math.min(maxLen + 4, 70) };
  });
}

/** Bold + colored header row */
function styleHeaderRow(ws: XLSX.WorkSheet, headers: string[], bgColor: string) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  for (let col = range.s.c; col <= range.e.c; col++) {
    const cellAddr = XLSX.utils.encode_cell({ r: 0, c: col });
    if (!ws[cellAddr]) continue;
    ws[cellAddr].s = {
      font: { bold: true, color: { rgb: COLOR_WHITE }, sz: 11 },
      fill: { fgColor: { rgb: bgColor } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: {
        bottom: { style: 'medium', color: { rgb: COLOR_WHITE } },
      },
    };
  }
}

/** Highlight KPI section headers (rows that start with ▶) */
function styleKpiHighlightRows(ws: XLSX.WorkSheet, rows: Record<string, any>[]) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  rows.forEach((row, rowIndex) => {
    const kpiVal = String(row['KPI'] || '');
    if (kpiVal.startsWith('▶')) {
      // Style section header rows with a light indigo background
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellAddr = XLSX.utils.encode_cell({ r: rowIndex + 1, c: col });
        if (!ws[cellAddr]) {
          ws[cellAddr] = { t: 's', v: '' };
        }
        ws[cellAddr].s = {
          font: { bold: true, color: { rgb: BRAND_INDIGO }, sz: 10 },
          fill: { fgColor: { rgb: 'EEF2FF' } },
          alignment: { vertical: 'center' },
        };
      }
    }
  });
}
