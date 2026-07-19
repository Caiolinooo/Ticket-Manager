import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import * as XLSX from 'xlsx';

// Priority labels PT-BR
const PRIORITY_LABEL: Record<string, string> = {
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
  URGENT: 'Urgente',
};

// Status labels PT-BR
const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Aberto',
  IN_PROGRESS: 'Em Andamento',
  PENDING: 'Pendente',
  RESOLVED: 'Resolvido',
  CLOSED: 'Fechado',
};

// Source labels PT-BR
const SOURCE_LABEL: Record<string, string> = {
  PORTAL: 'Portal do Cliente',
  TEAMS: 'Microsoft Teams',
  EMAIL: 'E-mail (Exchange)',
  PHONE: 'Telefone',
  MANUAL: 'Abertura Manual',
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

    if (!session || (session.role !== 'ADMIN' && session.role !== 'AGENT')) {
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

    // Fetch tickets (filtered by date range if provided)
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

    // ── SHEET 1: Relatório Completo ──────────────────────────────────────────
    const reportRows = tickets.map((t, index) => {
      const createdDate = new Date(t.createdAt);
      const resolvedDate = t.resolvedAt ? new Date(t.resolvedAt) : null;
      let resolutionTimeHours = '';

      if (resolvedDate) {
        const diffMs = resolvedDate.getTime() - createdDate.getTime();
        resolutionTimeHours = (diffMs / (1000 * 60 * 60)).toFixed(2);
      }

      return {
        'Nº': index + 1,
        'ID do Ticket': t.id,
        'Título': t.title,
        'Descrição': t.description.substring(0, 200) + (t.description.length > 200 ? '...' : ''),
        'Categoria': t.category,
        'Prioridade': PRIORITY_LABEL[t.priority] || t.priority,
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
        'Tempo de Resolução (h)': resolutionTimeHours || '—',
        'Solução / Resolução': (t as any).resolution || '—',
        'Qtd. Mensagens': t.messages?.length ?? 0,
      };
    });

    // ── SHEET 2: Resumo Executivo ────────────────────────────────────────────
    const totalTickets = tickets.length;
    const resolvedTickets = tickets.filter(t => t.status === 'RESOLVED' || t.status === 'CLOSED').length;
    const openTickets = tickets.filter(t => t.status === 'OPEN').length;
    const inProgressTickets = tickets.filter(t => t.status === 'IN_PROGRESS').length;
    const pendingTickets = tickets.filter(t => t.status === 'PENDING').length;
    const urgentTickets = tickets.filter(t => t.priority === 'URGENT').length;
    const highTickets = tickets.filter(t => t.priority === 'HIGH').length;

    const resolvedWithTime = tickets.filter(t => t.resolvedAt);
    const avgResolutionHours =
      resolvedWithTime.length > 0
        ? (
            resolvedWithTime.reduce((sum, t) => {
              const diff =
                new Date(t.resolvedAt!).getTime() - new Date(t.createdAt).getTime();
              return sum + diff / (1000 * 60 * 60);
            }, 0) / resolvedWithTime.length
          ).toFixed(2)
        : '—';

    const resolutionRate =
      totalTickets > 0
        ? ((resolvedTickets / totalTickets) * 100).toFixed(1) + '%'
        : '0.0%';

    // SLA breaches: HIGH or URGENT tickets open for more than 2 hours
    const slaBreaches = tickets.filter(t => {
      if (t.status === 'RESOLVED' || t.status === 'CLOSED') return false;
      if (t.priority !== 'HIGH' && t.priority !== 'URGENT') return false;
      const ageMs = Date.now() - new Date(t.createdAt).getTime();
      return ageMs > 1000 * 60 * 120;
    }).length;

    // Category breakdown
    const categoryCount: Record<string, number> = {};
    tickets.forEach(t => {
      categoryCount[t.category] = (categoryCount[t.category] || 0) + 1;
    });

    // Source breakdown
    const sourceCount: Record<string, number> = {};
    tickets.forEach(t => {
      const label = SOURCE_LABEL[t.source] || t.source;
      sourceCount[label] = (sourceCount[label] || 0) + 1;
    });

    // Priority breakdown
    const priorityCount: Record<string, number> = {};
    tickets.forEach(t => {
      const label = PRIORITY_LABEL[t.priority] || t.priority;
      priorityCount[label] = (priorityCount[label] || 0) + 1;
    });

    const summaryRows = [
      { 'Indicador': '📋 PERÍODO ANALISADO', 'Valor': periodLabel },
      { 'Indicador': '', 'Valor': '' },
      { 'Indicador': '📊 TOTAL DE CHAMADOS', 'Valor': totalTickets },
      { 'Indicador': '✅ Resolvidos / Fechados', 'Valor': resolvedTickets },
      { 'Indicador': '🔄 Em Andamento', 'Valor': inProgressTickets },
      { 'Indicador': '⏳ Pendentes', 'Valor': pendingTickets },
      { 'Indicador': '🔴 Em Aberto', 'Valor': openTickets },
      { 'Indicador': '🚨 Urgentes', 'Valor': urgentTickets },
      { 'Indicador': '⚠️ Alta Prioridade', 'Valor': highTickets },
      { 'Indicador': '📈 Taxa de Resolução', 'Valor': resolutionRate },
      { 'Indicador': '⏱️ Tempo Médio de Resolução (h)', 'Valor': avgResolutionHours },
      { 'Indicador': '🚫 Estouros de SLA (Alta/Urgente >2h)', 'Valor': slaBreaches },
      { 'Indicador': '', 'Valor': '' },
      { 'Indicador': '── POR CATEGORIA ──', 'Valor': '' },
      ...Object.entries(categoryCount).map(([cat, count]) => ({
        'Indicador': `  ${cat}`,
        'Valor': count,
      })),
      { 'Indicador': '', 'Valor': '' },
      { 'Indicador': '── POR CANAL DE ORIGEM ──', 'Valor': '' },
      ...Object.entries(sourceCount).map(([src, count]) => ({
        'Indicador': `  ${src}`,
        'Valor': count,
      })),
      { 'Indicador': '', 'Valor': '' },
      { 'Indicador': '── POR PRIORIDADE ──', 'Valor': '' },
      ...Object.entries(priorityCount).map(([pri, count]) => ({
        'Indicador': `  ${pri}`,
        'Valor': count,
      })),
    ];

    // ── SHEET 3: KPIs do Período ────────────────────────────────────────────
    // Daily volume: count tickets per day in the period
    const dailyVolume: Record<string, number> = {};
    tickets.forEach(t => {
      const day = new Date(t.createdAt)
        .toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' });
      dailyVolume[day] = (dailyVolume[day] || 0) + 1;
    });

    // Agent performance: tickets assigned and resolved per agent
    const agentStats: Record<string, { assigned: number; resolved: number; totalHours: number }> = {};
    tickets.forEach(t => {
      const agentName = t.assignee?.name || 'Não Atribuído';
      if (!agentStats[agentName]) agentStats[agentName] = { assigned: 0, resolved: 0, totalHours: 0 };
      agentStats[agentName].assigned++;
      if ((t.status === 'RESOLVED' || t.status === 'CLOSED') && t.resolvedAt) {
        agentStats[agentName].resolved++;
        const hrs = (new Date(t.resolvedAt).getTime() - new Date(t.createdAt).getTime()) / (1000 * 60 * 60);
        agentStats[agentName].totalHours += hrs;
      }
    });

    const kpiRows = [
      // ── Header section ──
      { 'KPI': '▶ INDICADORES CHAVE DE DESEMPENHO (KPI)', 'Valor': '', 'Contexto': `Período: ${periodLabel}` },
      { 'KPI': '', 'Valor': '', 'Contexto': '' },

      // ── Volume ──
      { 'KPI': '📊 Volume Total de Chamados', 'Valor': totalTickets, 'Contexto': 'Total no período' },
      { 'KPI': '🟢 Resolvidos / Fechados', 'Valor': resolvedTickets, 'Contexto': '' },
      { 'KPI': '🔵 Em Andamento', 'Valor': inProgressTickets, 'Contexto': '' },
      { 'KPI': '🟡 Pendentes', 'Valor': pendingTickets, 'Contexto': '' },
      { 'KPI': '🔴 Em Aberto', 'Valor': openTickets, 'Contexto': '' },
      { 'KPI': '', 'Valor': '', 'Contexto': '' },

      // ── Quality ──
      { 'KPI': '📈 Taxa de Resolução', 'Valor': resolutionRate, 'Contexto': 'Resolvidos ÷ Total' },
      { 'KPI': '⏱️ MTTR (Tempo Médio de Resolução)', 'Valor': avgResolutionHours !== '—' ? `${avgResolutionHours}h` : '—', 'Contexto': 'Mean Time To Resolve' },
      { 'KPI': '🚫 Estouros de SLA', 'Valor': slaBreaches, 'Contexto': 'Alta/Urgente abertos >2h' },
      { 'KPI': '', 'Valor': '', 'Contexto': '' },

      // ── Priority breakdown ──
      { 'KPI': '▶ DISTRIBUIÇÃO POR PRIORIDADE', 'Valor': '', 'Contexto': '' },
      ...Object.entries(priorityCount).map(([pri, count]) => ({
        'KPI': `  ${pri}`,
        'Valor': count,
        'Contexto': totalTickets > 0 ? `${((count / totalTickets) * 100).toFixed(1)}%` : '0.0%',
      })),
      { 'KPI': '', 'Valor': '', 'Contexto': '' },

      // ── Category breakdown ──
      { 'KPI': '▶ DISTRIBUIÇÃO POR CATEGORIA', 'Valor': '', 'Contexto': '' },
      ...Object.entries(categoryCount).map(([cat, count]) => ({
        'KPI': `  ${cat}`,
        'Valor': count,
        'Contexto': totalTickets > 0 ? `${((count / totalTickets) * 100).toFixed(1)}%` : '0.0%',
      })),
      { 'KPI': '', 'Valor': '', 'Contexto': '' },

      // ── Source breakdown ──
      { 'KPI': '▶ DISTRIBUIÇÃO POR CANAL DE ORIGEM', 'Valor': '', 'Contexto': '' },
      ...Object.entries(sourceCount).map(([src, count]) => ({
        'KPI': `  ${src}`,
        'Valor': count,
        'Contexto': totalTickets > 0 ? `${((count / totalTickets) * 100).toFixed(1)}%` : '0.0%',
      })),
      { 'KPI': '', 'Valor': '', 'Contexto': '' },

      // ── Daily volume ──
      { 'KPI': '▶ VOLUME DIÁRIO DE CHAMADOS', 'Valor': '', 'Contexto': '' },
      ...Object.entries(dailyVolume)
        .sort((a, b) => {
          // Sort by date (DD/MM/YYYY → parse to Date for comparison)
          const [da, ma, ya] = a[0].split('/').map(Number);
          const [db, mb, yb] = b[0].split('/').map(Number);
          return new Date(ya, ma - 1, da).getTime() - new Date(yb, mb - 1, db).getTime();
        })
        .map(([day, count]) => ({
          'KPI': `  ${day}`,
          'Valor': count,
          'Contexto': '',
        })),
      { 'KPI': '', 'Valor': '', 'Contexto': '' },

      // ── Agent performance ──
      { 'KPI': '▶ DESEMPENHO POR TÉCNICO', 'Valor': '', 'Contexto': '' },
      ...Object.entries(agentStats).map(([agent, stats]) => ({
        'KPI': `  ${agent}`,
        'Valor': `${stats.assigned} atribuídos / ${stats.resolved} resolvidos`,
        'Contexto': stats.resolved > 0
          ? `MTTR: ${(stats.totalHours / stats.resolved).toFixed(1)}h`
          : '—',
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
    const filename = `ABZGroup_Chamados_TI${periodSuffix}_${today}.xlsx`;

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
