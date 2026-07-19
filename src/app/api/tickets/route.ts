import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET() {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json({ success: false, error: 'Não autorizado' }, { status: 401 });
    }

    let tickets;

    if (session.role === 'EMPLOYEE') {
      // Employee can only see their own tickets — but we must verify they exist in DB
      const dbUser = await prisma.supportUser.findUnique({ where: { id: session.id } });
      if (!dbUser) {
        return NextResponse.json({ success: false, error: 'Sessão inválida. Por favor, faça login novamente.' }, { status: 401 });
      }
      tickets = await prisma.ticket.findMany({
        where: { createdById: session.id },
        include: {
          creator: { select: { id: true, name: true, email: true } },
          assignee: { select: { id: true, name: true, email: true } },
          messages: { orderBy: { createdAt: 'asc' } },
        },
        orderBy: { createdAt: 'desc' },
      });
    } else {
      // ADMIN or AGENT
      tickets = await prisma.ticket.findMany({
        include: {
          creator: { select: { id: true, name: true, email: true } },
          assignee: { select: { id: true, name: true, email: true } },
          messages: { orderBy: { createdAt: 'asc' } },
          externalTraces: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    return NextResponse.json({ success: true, tickets });
  } catch (error: any) {
    console.error('Fetch tickets error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
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
      return NextResponse.json({ success: false, error: 'Preencha todos os campos obrigatórios' }, { status: 400 });
    }

    // Resolve a real user from DB — session.id may be stale after a DB reset
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
      }
    });

    // Write audit log — using the verified DB user ID
    try {
      await prisma.auditLog.create({
        data: {
          userId: dbUser.id,
          action: 'TICKET_CREATE',
          details: `Ticket "${ticket.title}" (${ticket.id}) aberto via Portal do Cliente.`
        }
      });
    } catch (auditError) {
      console.error('Ticket create audit log error (non-critical):', auditError);
    }

    return NextResponse.json({ success: true, ticket });
  } catch (error: any) {
    console.error('Create ticket error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
