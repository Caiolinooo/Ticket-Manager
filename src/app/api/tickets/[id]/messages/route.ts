import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import {
  canAccessTicket,
  isAdminRole,
  isEmployeeRole,
  isOperatorRole,
  isTechnicianRole,
} from '@/lib/permissions';
import {
  getTechnicianProfile,
  getVisibleAccountUpnsForUser,
} from '@/lib/technician-routing';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    const { id: ticketId } = await params;

    if (!session) {
      return NextResponse.json({ success: false, error: 'Não autorizado' }, { status: 401 });
    }

    const { content } = await request.json();

    if (!content || !content.trim()) {
      return NextResponse.json(
        { success: false, error: 'O conteúdo da mensagem não pode ser vazio' },
        { status: 400 }
      );
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
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

    const message = await prisma.ticketMessage.create({
      data: {
        ticketId,
        senderId: session.id,
        content: content.trim(),
      },
      include: {
        sender: { select: { id: true, name: true, role: true } },
      },
    });

    if (isOperatorRole(session.role) && ticket.status === 'OPEN') {
      await prisma.ticket.update({
        where: { id: ticketId },
        data: { status: 'IN_PROGRESS' },
      });

      await prisma.auditLog.create({
        data: {
          userId: session.id,
          action: 'TICKET_STATUS_CHANGE',
          details: `Ticket "${ticket.title}" atualizado automaticamente para EM ANDAMENTO devido à resposta do atendente.`,
        },
      });
    }

    return NextResponse.json({ success: true, message });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro interno';
    console.error('Add message error:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
