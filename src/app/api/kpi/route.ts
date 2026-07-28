import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { isOperatorRole } from '@/lib/permissions';

/**
 * Sector-wide KPI dataset — ALWAYS full sector for ADMIN and TECHNICIAN.
 * Do not apply technician mailbox filters here.
 */
export async function GET(request: Request) {
  try {
    const session = await getSession();

    if (!session || !isOperatorRole(session.role)) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');

    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (dateFrom) dateFilter.gte = new Date(dateFrom + 'T00:00:00Z');
    if (dateTo) dateFilter.lte = new Date(dateTo + 'T23:59:59Z');

    const tickets = await prisma.ticket.findMany({
      where: Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : undefined,
      include: {
        creator: { select: { id: true, name: true, email: true } },
        assignee: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const total = tickets.length;
    const resolved = tickets.filter((t) => t.status === 'RESOLVED' || t.status === 'CLOSED').length;
    const open = tickets.filter((t) => t.status === 'OPEN').length;
    const inProgress = tickets.filter((t) => t.status === 'IN_PROGRESS').length;
    const pending = tickets.filter((t) => t.status === 'PENDING').length;

    const resolvedWithTime = tickets.filter(
      (t) => (t.status === 'RESOLVED' || t.status === 'CLOSED') && t.resolvedAt
    );
    let mttrHours = 0;
    if (resolvedWithTime.length > 0) {
      const totalMs = resolvedWithTime.reduce((acc, t) => {
        return acc + (new Date(t.resolvedAt!).getTime() - new Date(t.createdAt).getTime());
      }, 0);
      mttrHours = totalMs / (resolvedWithTime.length * 1000 * 60 * 60);
    }

    const slaBreaches = tickets.filter((t) => {
      if (t.status === 'RESOLVED' || t.status === 'CLOSED') return false;
      if (t.priority !== 'HIGH' && t.priority !== 'URGENT') return false;
      return Date.now() - new Date(t.createdAt).getTime() > 1000 * 60 * 120;
    }).length;

    return NextResponse.json({
      success: true,
      scope: 'sector',
      unified: true,
      tickets,
      summary: {
        total,
        resolved,
        open,
        inProgress,
        pending,
        resolutionRate: total > 0 ? (resolved / total) * 100 : 0,
        mttrHours,
        slaBreaches,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro interno';
    console.error('KPI fetch error:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
