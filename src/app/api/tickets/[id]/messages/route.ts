import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';

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
      return NextResponse.json({ success: false, error: 'O conteúdo da mensagem não pode ser vazio' }, { status: 400 });
    }

    // Check if ticket exists
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId }
    });

    if (!ticket) {
      return NextResponse.json({ success: false, error: 'Ticket não encontrado' }, { status: 404 });
    }

    // Create the message
    const message = await prisma.ticketMessage.create({
      data: {
        ticketId,
        senderId: session.id,
        content: content.trim(),
      },
      include: {
        sender: { select: { id: true, name: true, role: true } }
      }
    });

    // Auto-update ticket status to IN_PROGRESS if an AGENT/ADMIN replies and the ticket is currently OPEN
    if ((session.role === 'AGENT' || session.role === 'ADMIN') && ticket.status === 'OPEN') {
      await prisma.ticket.update({
        where: { id: ticketId },
        data: { status: 'IN_PROGRESS' }
      });

      await prisma.auditLog.create({
        data: {
          userId: session.id,
          action: 'TICKET_STATUS_CHANGE',
          details: `Ticket "${ticket.title}" atualizado automaticamente para EM ANDAMENTO devido à resposta do atendente.`,
        }
      });
    }

    return NextResponse.json({ success: true, message });
  } catch (error: any) {
    console.error('Add message error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
