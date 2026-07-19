import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET() {
  try {
    const session = await getSession();

    if (!session || (session.role !== 'ADMIN' && session.role !== 'AGENT')) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    const agents = await prisma.supportUser.findMany({
      where: {
        role: { in: ['ADMIN', 'AGENT'] }
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      }
    });

    return NextResponse.json({ success: true, agents });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
