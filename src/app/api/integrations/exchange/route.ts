import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { fetchExchangeEmails } from '@/lib/microsoft';
import { analyzeIncomingMessage } from '@/lib/ai';
import {
  clusterMessages,
  processMessageBatch,
  upsertGroupedTrace,
  GROUP_WINDOW_MS,
} from '@/lib/trace-grouping';
import type { MicrosoftMessage } from '@/lib/microsoft';

export async function GET() {
  try {
    const collection = await fetchExchangeEmails();
    const batch = await processMessageBatch(collection.messages);

    const hasHardFailure = !collection.authOk || collection.errors.length > 0;

    return NextResponse.json({
      success: !hasHardFailure,
      processedCount: collection.messages.length,
      processedClusters: batch.processedClusters,
      createdTraces: batch.created,
      mergedTraces: batch.merged,
      skippedClusters: batch.skipped,
      groupWindowMinutes: GROUP_WINDOW_MS / 60000,
      newPendingTraces: batch.newPendingTraces.map((t) => ({
        traceId: t.traceId,
        sender: t.sender,
        subject: undefined as string | undefined,
        content: t.content,
        aiAnalysis: t.aiAnalysis,
        action: t.action,
      })),
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
    const body = await request.json();
    const { senderName, senderEmail, content, subject } = body;

    if (!senderName || !senderEmail || !content || !subject) {
      return NextResponse.json({ success: false, error: 'Campos obrigatórios ausentes' }, { status: 400 });
    }

    const normalizedSubject = subject
      .replace(/^(re|fw|enc|res):\s*/gi, '')
      .trim()
      .toLowerCase();

    const msg: MicrosoftMessage = {
      id: body.id || `exchange-injected-${Date.now()}`,
      senderName,
      senderEmail,
      subjectOrChannel: subject,
      bodyPreview: content,
      receivedDateTime: body.receivedAt ? new Date(body.receivedAt) : new Date(),
      platform: 'EXCHANGE',
      conversationId:
        body.conversationId ||
        `email:${senderEmail.toLowerCase()}:${normalizedSubject || '(sem-assunto)'}`,
    };

    const result = await upsertGroupedTrace(clusterMessages([msg])[0]);
    const trace = result.traceId
      ? await prisma.externalTrace.findUnique({ where: { id: result.traceId } })
      : null;

    const aiAnalysis =
      result.aiAnalysis ||
      (await analyzeIncomingMessage(content, senderName, 'EXCHANGE', {
        conversationId: msg.conversationId,
      }));

    return NextResponse.json({
      success: true,
      action: result.action,
      trace,
      aiAnalysis,
    });
  } catch (error: any) {
    console.error('Exchange injection error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
