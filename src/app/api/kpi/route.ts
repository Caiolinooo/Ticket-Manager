import { type NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { isOperatorRole } from '@/lib/permissions';
import {
  computeKpiReport,
  computeTrendDelta,
  previousPeriodRange,
  type KpiTicketInput,
} from '@/lib/kpi-metrics';

/**
 * Sector-wide KPI dataset — ALWAYS full sector for ADMIN and TECHNICIAN.
 * Do not apply technician mailbox filters here.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session || !isOperatorRole(session.role)) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    const searchParams = request.nextUrl.searchParams;
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const includeTickets = searchParams.get('includeTickets') !== '0';

    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (dateFrom) dateFilter.gte = new Date(dateFrom + 'T00:00:00Z');
    if (dateTo) dateFilter.lte = new Date(dateTo + 'T23:59:59Z');

    const ticketInclude = {
      creator: { select: { id: true, name: true, email: true } },
      assignee: { select: { id: true, name: true, email: true } },
      messages: {
        orderBy: { createdAt: 'asc' as const },
        take: 30,
        select: { createdAt: true, senderId: true },
      },
    };

    const tickets = await prisma.ticket.findMany({
      where: Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : undefined,
      include: ticketInclude,
      orderBy: { createdAt: 'desc' },
    });

    const asInput: KpiTicketInput[] = tickets.map((t) => ({
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

    const report = computeKpiReport(asInput);

    let trend = null;
    if (dateFrom && dateTo) {
      const prev = previousPeriodRange(dateFrom, dateTo);
      if (prev) {
        const prevTickets = await prisma.ticket.findMany({
          where: {
            createdAt: {
              gte: new Date(prev.from + 'T00:00:00Z'),
              lte: new Date(prev.to + 'T23:59:59Z'),
            },
          },
          include: ticketInclude,
        });
        const prevReport = computeKpiReport(
          prevTickets.map((t) => ({
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
          }))
        );
        trend = {
          previousPeriod: prev,
          previousSummary: prevReport.summary,
          delta: computeTrendDelta(report.summary, prevReport.summary),
        };
      }
    }

    return NextResponse.json({
      success: true,
      scope: 'sector',
      unified: true,
      period: { from: dateFrom, to: dateTo },
      summary: report.summary,
      breakdowns: report.breakdowns,
      definitions: report.definitions,
      trend,
      tickets: includeTickets
        ? tickets.map((t) => ({
            id: t.id,
            title: t.title,
            description: t.description,
            status: t.status,
            priority: t.priority,
            category: t.category,
            source: t.source,
            resolution: t.resolution,
            createdById: t.createdById,
            assignedToId: t.assignedToId,
            createdAt: t.createdAt,
            resolvedAt: t.resolvedAt,
            creator: t.creator,
            assignee: t.assignee,
            messages: t.messages,
          }))
        : undefined,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro interno';
    console.error('KPI fetch error:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
