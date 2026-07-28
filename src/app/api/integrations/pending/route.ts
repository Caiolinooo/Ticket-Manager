import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { isOperatorRole, isAdminRole, isTechnicianRole } from '@/lib/permissions';
import {
  externalTraceWhereForAccounts,
  getTechnicianProfile,
  getVisibleAccountUpnsForUser,
} from '@/lib/technician-routing';

export async function GET() {
  try {
    const session = await getSession();

    if (!session || !isOperatorRole(session.role)) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    let where: Record<string, unknown> = { status: 'PENDING_APPROVAL' };
    let scope: 'sector' | 'routed' = 'sector';

    if (isTechnicianRole(session.role) && !isAdminRole(session.role)) {
      const profile = await getTechnicianProfile(session.id);
      const visible = await getVisibleAccountUpnsForUser(session);
      const mode = profile?.receiveMode || 'SHARED_WITH_ADMIN';
      where = {
        status: 'PENDING_APPROVAL',
        ...externalTraceWhereForAccounts(visible, mode),
      };
      scope = 'routed';
    }

    const pendingTraces = await prisma.externalTrace.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
    });

    return NextResponse.json({
      success: true,
      pendingTraces,
      scope,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro interno';
    console.error('Fetch pending traces error:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
