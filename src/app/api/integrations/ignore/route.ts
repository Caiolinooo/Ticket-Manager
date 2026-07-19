import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function POST(request: Request) {
  try {
    const { traceId } = await request.json();

    if (!traceId) {
      return NextResponse.json({ success: false, error: 'traceId é obrigatório' }, { status: 400 });
    }

    const trace = await prisma.externalTrace.findUnique({
      where: { id: traceId }
    });

    if (!trace) {
      return NextResponse.json({ success: false, error: 'Trace não encontrado' }, { status: 404 });
    }

    // Update status to IGNORED
    await prisma.externalTrace.update({
      where: { id: trace.id },
      data: { status: 'IGNORED' }
    });

    // Write Audit Log — always resolve a valid admin user from DB to avoid stale session FK errors
    try {
      const admin = await prisma.supportUser.findFirst({ where: { role: 'ADMIN' } });
      if (admin) {
        await prisma.auditLog.create({
          data: {
            userId: admin.id,
            action: 'INTEGRATION_IGNORE',
            details: `Mensagem pendente do ${trace.platform} (${trace.id}) marcada como ignorada.`,
          }
        });
      }
    } catch (auditError) {
      console.error('Ignore trace audit log error (non-critical):', auditError);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Ignore trace error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
