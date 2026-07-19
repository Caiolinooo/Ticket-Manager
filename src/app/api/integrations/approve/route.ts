import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { analyzeIncomingMessage } from '@/lib/ai';

export async function POST(request: Request) {
  try {
    const { traceId } = await request.json();

    if (!traceId) {
      return NextResponse.json({ success: false, error: 'traceId é obrigatório' }, { status: 400 });
    }

    // 1. Fetch trace
    const trace = await prisma.externalTrace.findUnique({
      where: { id: traceId }
    });

    if (!trace) {
      return NextResponse.json({ success: false, error: 'Trace não encontrado' }, { status: 404 });
    }

    if (trace.status !== 'PENDING_APPROVAL') {
      return NextResponse.json({ success: false, error: 'Esta pendência já foi processada' }, { status: 400 });
    }

    // 2. Extract email from originalSender (e.g. "João Silva (joao.silva@empresa.com)")
    let email = '';
    const emailMatch = trace.originalSender.match(/\(([^)]+)\)/);
    if (emailMatch && emailMatch[1]) {
      email = emailMatch[1].trim();
    } else {
      email = trace.originalSender.trim();
    }

    // 3. Find or create Employee User
    let employee = await prisma.supportUser.findUnique({ where: { email } });
    if (!employee) {
      const cleanName = trace.originalSender.split('(')[0].trim() || 'Usuário Integrado';
      employee = await prisma.supportUser.create({
        data: {
          email,
          name: cleanName,
          role: 'EMPLOYEE',
          passwordHash: 'no-login-external-user',
        }
      });
    }

    // 4. Run AI analysis to get structured category, priority, and title
    const analysis = await analyzeIncomingMessage(trace.rawContent, employee.name);

    // 5. Create Ticket
    const ticket = await prisma.ticket.create({
      data: {
        title: analysis.title || trace.channelOrSubject || 'Chamado via ' + trace.platform,
        description: trace.rawContent,
        status: 'OPEN',
        priority: analysis.priority || 'MEDIUM',
        category: analysis.category || 'Geral',
        source: trace.platform,
        externalReferenceId: trace.externalId,
        createdById: employee.id,
      }
    });

    // 6. Update trace
    await prisma.externalTrace.update({
      where: { id: trace.id },
      data: {
        status: 'APPROVED',
        ticketId: ticket.id,
      }
    });

    // 7. Write Audit Log — always resolve a valid admin from DB to avoid stale session FK errors
    try {
      const admin = await prisma.supportUser.findFirst({ where: { role: 'ADMIN' } });
      const auditorId = admin?.id || employee.id;
      await prisma.auditLog.create({
        data: {
          userId: auditorId,
          action: 'TICKET_CREATE_FROM_INTEGRATION',
          details: `Ticket "${ticket.title}" (${ticket.id}) criado a partir de pendência do ${trace.platform} de ${trace.originalSender}.`,
        }
      });
    } catch (auditError) {
      console.error('Approve trace audit log error (non-critical):', auditError);
    }

    return NextResponse.json({
      success: true,
      ticket
    });
  } catch (error: any) {
    console.error('Approve trace error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
