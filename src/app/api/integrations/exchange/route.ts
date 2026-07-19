import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { fetchExchangeEmails } from '@/lib/microsoft';
import { analyzeIncomingMessage } from '@/lib/ai';

export async function GET() {
  try {
    const collection = await fetchExchangeEmails();
    const newTraces = [];

    for (const email of collection.messages) {
      const existing = await prisma.externalTrace.findUnique({
        where: { externalId: email.id }
      });

      if (!existing) {
        const analysis = await analyzeIncomingMessage(email.bodyPreview, email.senderName, 'EXCHANGE');

        const trace = await prisma.externalTrace.create({
          data: {
            platform: 'EXCHANGE',
            externalId: email.id,
            originalSender: `${email.senderName} (${email.senderEmail})`,
            channelOrSubject: email.subjectOrChannel,
            rawContent: email.bodyPreview,
            status: analysis.isIssue ? 'PENDING_APPROVAL' : 'IGNORED',
            receivedAt: email.receivedDateTime,
          }
        });

        if (analysis.isIssue) {
          newTraces.push({
            traceId: trace.id,
            sender: trace.originalSender,
            subject: trace.channelOrSubject,
            aiAnalysis: analysis
          });
        }
      }
    }

    const hasHardFailure = !collection.authOk || collection.errors.length > 0;

    return NextResponse.json({
      success: !hasHardFailure,
      processedCount: collection.messages.length,
      newPendingTraces: newTraces,
      authOk: collection.authOk,
      disabled: collection.disabled,
      monitoredAccounts: collection.monitoredAccounts,
      warnings: collection.warnings,
      errors: collection.errors,
      error: hasHardFailure
        ? (collection.errors[0] || 'Falha na coleta Exchange')
        : undefined,
    }, { status: hasHardFailure ? 502 : 200 });
  } catch (error: any) {
    console.error('Exchange integration error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// Post endpoint for injecting custom Exchange emails from Simulator
export async function POST(request: Request) {
  try {
    const { senderName, senderEmail, content, subject } = await request.json();

    if (!senderName || !senderEmail || !content || !subject) {
      return NextResponse.json({ success: false, error: 'Campos obrigatórios ausentes' }, { status: 400 });
    }

    const mockId = 'exchange-injected-' + Date.now();
    const analysis = await analyzeIncomingMessage(content, senderName, 'EXCHANGE');

    const trace = await prisma.externalTrace.create({
      data: {
        platform: 'EXCHANGE',
        externalId: mockId,
        originalSender: `${senderName} (${senderEmail})`,
        channelOrSubject: subject,
        rawContent: content,
        status: analysis.isIssue ? 'PENDING_APPROVAL' : 'IGNORED',
        receivedAt: new Date(),
      }
    });

    return NextResponse.json({
      success: true,
      trace,
      aiAnalysis: analysis
    });
  } catch (error: any) {
    console.error('Exchange injection error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
