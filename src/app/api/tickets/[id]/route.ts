import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import {
  canAccessTicket,
  isEmployeeRole,
  isOperatorRole,
  isAdminRole,
  isTechnicianRole,
} from '@/lib/permissions';
import {
  getTechnicianProfile,
  getVisibleAccountUpnsForUser,
} from '@/lib/technician-routing';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    const { id } = await params;

    if (!session) {
      return NextResponse.json({ success: false, error: 'Não autorizado' }, { status: 401 });
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, name: true, email: true } },
        assignee: { select: { id: true, name: true, email: true } },
        messages: {
          include: {
            sender: { select: { id: true, name: true, role: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        externalTraces: true,
      },
    });

    if (!ticket) {
      return NextResponse.json({ success: false, error: 'Ticket não encontrado' }, { status: 404 });
    }

    if (isEmployeeRole(session.role) && ticket.createdById !== session.id) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    if (isTechnicianRole(session.role) && !isAdminRole(session.role)) {
      const profile = await getTechnicianProfile(session.id);
      const visible = await getVisibleAccountUpnsForUser(session);
      const allowed = canAccessTicket(session, ticket, {
        receiveMode: profile?.receiveMode || 'SHARED_WITH_ADMIN',
        visibleAccounts: visible,
      });
      if (!allowed) {
        return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
      }
    }

    return NextResponse.json({ success: true, ticket });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro interno';
    console.error('Get ticket details error:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    const { id } = await params;

    if (!session) {
      return NextResponse.json({ success: false, error: 'Não autorizado' }, { status: 401 });
    }

    const data = await request.json();
    const { status, priority, category, assignedToId, resolution } = data;

    const ticket = await prisma.ticket.findUnique({ where: { id } });

    if (!ticket) {
      return NextResponse.json({ success: false, error: 'Ticket não encontrado' }, { status: 404 });
    }

    if (isEmployeeRole(session.role)) {
      if (ticket.createdById !== session.id) {
        return NextResponse.json({ success: false, error: 'Não autorizado' }, { status: 403 });
      }
      if (status && status !== 'CLOSED' && status !== 'RESOLVED') {
        return NextResponse.json(
          { success: false, error: 'Funcionários só podem fechar ou resolver chamados.' },
          { status: 403 }
        );
      }
    } else if (!isOperatorRole(session.role)) {
      return NextResponse.json({ success: false, error: 'Não autorizado' }, { status: 403 });
    } else if (isTechnicianRole(session.role) && !isAdminRole(session.role)) {
      const profile = await getTechnicianProfile(session.id);
      const visible = await getVisibleAccountUpnsForUser(session);
      const allowed = canAccessTicket(session, ticket, {
        receiveMode: profile?.receiveMode || 'SHARED_WITH_ADMIN',
        visibleAccounts: visible,
      });
      if (!allowed) {
        return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
      }
    }

    const isClosing = status === 'RESOLVED' || status === 'CLOSED';
    const finalResolution = resolution || ticket.resolution || null;

    const updateData: Record<string, unknown> = {};
    if (status) {
      updateData.status = status;
      updateData.resolvedAt = isClosing ? new Date() : null;
    }
    if (priority) updateData.priority = priority;
    if (category) updateData.category = category;
    if (assignedToId !== undefined) updateData.assignedToId = assignedToId;
    if (finalResolution !== null) updateData.resolution = finalResolution;

    const updatedTicket = await prisma.ticket.update({
      where: { id },
      data: updateData,
      include: {
        creator: { select: { id: true, name: true, email: true } },
        assignee: { select: { id: true, name: true, email: true } },
      },
    });

    try {
      const auditorId = isOperatorRole(session.role)
        ? session.id
        : (await prisma.supportUser.findFirst({ where: { role: 'ADMIN' } }))?.id ||
          ticket.createdById;
      let detailsStr = `Ticket "${ticket.title}" (${ticket.id}) atualizado:`;
      if (status) detailsStr += ` Status [${ticket.status} → ${status}].`;
      if (priority) detailsStr += ` Prioridade [${ticket.priority} → ${priority}].`;
      if (assignedToId) detailsStr += ` Técnico Associado [ID: ${assignedToId}].`;
      if (finalResolution) detailsStr += ` Resolução registrada.`;

      await prisma.auditLog.create({
        data: { userId: auditorId, action: 'TICKET_UPDATE', details: detailsStr },
      });
    } catch (auditError) {
      console.error('Ticket update audit log error (non-critical):', auditError);
    }

    const needsResolution = isClosing && !finalResolution;

    return NextResponse.json({ success: true, ticket: updatedTicket, needsResolution });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro interno';
    console.error('Update ticket error:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
