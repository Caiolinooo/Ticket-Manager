import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET() {
  try {
    const session = await getSession();

    if (!session || (session.role !== 'ADMIN' && session.role !== 'AGENT')) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    const pendingTraces = await prisma.externalTrace.findMany({
      where: { status: 'PENDING_APPROVAL' },
      orderBy: { receivedAt: 'desc' }
    });

    return NextResponse.json({
      success: true,
      pendingTraces
    });
  } catch (error: any) {
    console.error('Fetch pending traces error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
