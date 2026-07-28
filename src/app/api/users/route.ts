import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { canListOperators } from '@/lib/permissions';

export async function GET() {
  try {
    const session = await getSession();

    if (!canListOperators(session)) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    const agents = await prisma.supportUser.findMany({
      where: {
        role: { in: ['ADMIN', 'TECHNICIAN', 'AGENT'] },
        active: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({ success: true, agents });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro interno';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
