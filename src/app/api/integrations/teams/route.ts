import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { fetchTeamsMessages } from '@/lib/microsoft';
import { analyzeIncomingMessage } from '@/lib/ai';

export async function GET() {
  try {
    const collection = await fetchTeamsMessages();
    const newTraces = [];

    for (const msg of collection.messages) {
      const existing = await prisma.externalTrace.findUnique({
        where: { externalId: msg.id }
      });

      if (!existing) {
        const analysis = await analyzeIncomingMessage(msg.bodyPreview, msg.senderName, 'TEAMS');

        const trace = await prisma.externalTrace.create({
          data: {
            platform: 'TEAMS',
            externalId: msg.id,
            originalSender: `${msg.senderName} (${msg.senderEmail})`,
            channelOrSubject: msg.subjectOrChannel,
            rawContent: msg.bodyPreview,
            status: analysis.isIssue ? 'PENDING_APPROVAL' : 'IGNORED',
            receivedAt: msg.receivedDateTime,
          }
        });

        if (analysis.isIssue) {
          newTraces.push({
            traceId: trace.id,
            sender: trace.originalSender,
            content: trace.rawContent,
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
        ? (collection.errors[0] || 'Falha na coleta Teams')
        : undefined,
    }, { status: hasHardFailure ? 502 : 200 });
  } catch (error: any) {
    console.error('Teams integration error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// Post endpoint for injecting custom Teams messages from Simulator
export async function POST(request: Request) {
  try {
    const { senderName, senderEmail, content, channelName } = await request.json();

    if (!senderName || !senderEmail || !content) {
      return NextResponse.json({ success: false, error: 'Campos obrigatórios ausentes' }, { status: 400 });
    }

    const mockId = 'teams-injected-' + Date.now();
    const analysis = await analyzeIncomingMessage(content, senderName, 'TEAMS');

    const trace = await prisma.externalTrace.create({
      data: {
        platform: 'TEAMS',
        externalId: mockId,
        originalSender: `${senderName} (${senderEmail})`,
        channelOrSubject: channelName || 'Chat Privado',
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
    console.error('Teams injection error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
