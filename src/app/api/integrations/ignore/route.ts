import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { canApproveIntegrations } from '@/lib/permissions';

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!canApproveIntegrations(session)) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    const { traceId } = await request.json();

    if (!traceId) {
      return NextResponse.json({ success: false, error: 'traceId é obrigatório' }, { status: 400 });
    }

    const trace = await prisma.externalTrace.findUnique({
      where: { id: traceId },
    });

    if (!trace) {
      return NextResponse.json({ success: false, error: 'Trace não encontrado' }, { status: 404 });
    }

    await prisma.externalTrace.update({
      where: { id: trace.id },
      data: { status: 'IGNORED' },
    });

    try {
      const auditorId =
        session?.id ||
        (await prisma.supportUser.findFirst({ where: { role: 'ADMIN' } }))?.id;
      if (auditorId) {
        await prisma.auditLog.create({
          data: {
            userId: auditorId,
            action: 'INTEGRATION_IGNORE',
            details: `Mensagem pendente do ${trace.platform} (${trace.id}) marcada como ignorada.`,
          },
        });
      }
    } catch (auditError) {
      console.error('Ignore trace audit log error (non-critical):', auditError);
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro interno';
    console.error('Ignore trace error:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
