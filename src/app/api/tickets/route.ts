import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { isEmployeeRole, isOperatorRole, isAdminRole, isTechnicianRole } from '@/lib/permissions';
import {
  getTechnicianProfile,
  getVisibleAccountUpnsForUser,
  ticketWhereForAccounts,
} from '@/lib/technician-routing';

const ticketInclude = {
  creator: { select: { id: true, name: true, email: true } },
  assignee: { select: { id: true, name: true, email: true } },
  messages: { orderBy: { createdAt: 'asc' as const } },
  externalTraces: true,
};

export async function GET() {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json({ success: false, error: 'Não autorizado' }, { status: 401 });
    }

    if (isEmployeeRole(session.role)) {
      const dbUser = await prisma.supportUser.findUnique({ where: { id: session.id } });
      if (!dbUser) {
        return NextResponse.json(
          { success: false, error: 'Sessão inválida. Por favor, faça login novamente.' },
          { status: 401 }
        );
      }
      const tickets = await prisma.ticket.findMany({
        where: { createdById: session.id },
        include: {
          creator: { select: { id: true, name: true, email: true } },
          assignee: { select: { id: true, name: true, email: true } },
          messages: { orderBy: { createdAt: 'asc' } },
        },
        orderBy: { createdAt: 'desc' },
      });
      return NextResponse.json({ success: true, tickets, scope: 'own' });
    }

    if (!isOperatorRole(session.role)) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    // Work queue: ADMIN sees all; TECHNICIAN filtered by receiveMode + accounts
    let where: Record<string, unknown> = {};
    let scope: 'sector' | 'routed' = 'sector';

    if (isTechnicianRole(session.role) && !isAdminRole(session.role)) {
      const profile = await getTechnicianProfile(session.id);
      const visible = await getVisibleAccountUpnsForUser(session);
      const mode = profile?.receiveMode || 'SHARED_WITH_ADMIN';
      where = ticketWhereForAccounts(visible, mode, session.id);
      scope = 'routed';
    }

    const tickets = await prisma.ticket.findMany({
      where,
      include: ticketInclude,
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ success: true, tickets, scope });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro interno';
    console.error('Fetch tickets error:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json({ success: false, error: 'Não autorizado' }, { status: 401 });
    }

    const { title, description, category, priority } = await request.json();

    if (!title || !description || !category || !priority) {
      return NextResponse.json(
        { success: false, error: 'Preencha todos os campos obrigatórios' },
        { status: 400 }
      );
    }

    const dbUser = await prisma.supportUser.findUnique({ where: { id: session.id } });
    if (!dbUser) {
      return NextResponse.json(
        { success: false, error: 'Sessão expirada ou inválida. Por favor, faça login novamente.' },
        { status: 401 }
      );
    }

    const ticket = await prisma.ticket.create({
      data: {
        title,
        description,
        status: 'OPEN',
        priority,
        category,
        source: 'PORTAL',
        createdById: dbUser.id,
      },
      include: {
        creator: { select: { id: true, name: true, email: true } },
      },
    });

    try {
      await prisma.auditLog.create({
        data: {
          userId: dbUser.id,
          action: 'TICKET_CREATE',
          details: `Ticket "${ticket.title}" (${ticket.id}) aberto via Portal do Cliente.`,
        },
      });
    } catch (auditError) {
      console.error('Ticket create audit log error (non-critical):', auditError);
    }

    return NextResponse.json({ success: true, ticket });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro interno';
    console.error('Create ticket error:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
