import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { suggestDirectFix } from '@/lib/ai';
import { getSession } from '@/lib/auth';
import { canAccessOperatorArea } from '@/lib/permissions';

export async function POST(request: Request) {
  try {
    const session = await getSession();

    if (!canAccessOperatorArea(session)) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    const { ticketId } = await request.json();

    if (!ticketId) {
      return NextResponse.json({ success: false, error: 'ticketId é obrigatório' }, { status: 400 });
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId }
    });

    if (!ticket) {
      return NextResponse.json({ success: false, error: 'Ticket não encontrado' }, { status: 404 });
    }

    // Call AI to generate fix steps
    const suggestion = await suggestDirectFix(ticket.title, ticket.description, ticket.category);

    return NextResponse.json({
      success: true,
      suggestion
    });
  } catch (error: any) {
    console.error('Suggest fix error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
