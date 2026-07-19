import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET(
  request: Request,
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
            sender: { select: { id: true, name: true, role: true } }
          },
          orderBy: { createdAt: 'asc' }
        },
        externalTraces: true
      }
    });

    if (!ticket) {
      return NextResponse.json({ success: false, error: 'Ticket não encontrado' }, { status: 404 });
    }

    if (session.role === 'EMPLOYEE' && ticket.createdById !== session.id) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    return NextResponse.json({ success: true, ticket });
  } catch (error: any) {
    console.error('Get ticket details error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
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

    // Authorization checks
    if (session.role === 'EMPLOYEE') {
      if (ticket.createdById !== session.id) {
        return NextResponse.json({ success: false, error: 'Não autorizado' }, { status: 403 });
      }
      if (status && status !== 'CLOSED' && status !== 'RESOLVED') {
        return NextResponse.json({ success: false, error: 'Funcionários só podem fechar ou resolver chamados.' }, { status: 403 });
      }
    }

    // When closing/resolving without a resolution text, we need to check for one in messages
    const isClosing = status === 'RESOLVED' || status === 'CLOSED';
    let finalResolution = resolution || (ticket as any).resolution || null;

    const updateData: any = {};
    if (status) {
      updateData.status = status;
      if (isClosing) {
        updateData.resolvedAt = new Date();
      } else {
        updateData.resolvedAt = null;
      }
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
      }
    });

    // Write audit log (resilient - always resolve admin from DB)
    try {
      const admin = await prisma.supportUser.findFirst({ where: { role: 'ADMIN' } });
      const auditorId = admin?.id || ticket.createdById;
      let detailsStr = `Ticket "${ticket.title}" (${ticket.id}) atualizado:`;
      if (status) detailsStr += ` Status [${ticket.status} → ${status}].`;
      if (priority) detailsStr += ` Prioridade [${ticket.priority} → ${priority}].`;
      if (assignedToId) detailsStr += ` Técnico Associado [ID: ${assignedToId}].`;
      if (finalResolution) detailsStr += ` Resolução registrada.`;

      await prisma.auditLog.create({
        data: { userId: auditorId, action: 'TICKET_UPDATE', details: detailsStr }
      });
    } catch (auditError) {
      console.error('Ticket update audit log error (non-critical):', auditError);
    }

    // If closing without resolution, signal frontend to prompt
    const needsResolution = isClosing && !finalResolution;

    return NextResponse.json({ success: true, ticket: updatedTicket, needsResolution });
  } catch (error: any) {
    console.error('Update ticket error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
