import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.role !== 'ADMIN') {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    const configs = await prisma.systemConfig.findMany();
    const configMap = configs.reduce((acc, curr) => {
      acc[curr.key] = curr.value;
      return acc;
    }, {} as Record<string, string>);

    return NextResponse.json({
      success: true,
      settings: {
        // AI Config
        ai_provider: configMap['ai_provider'] || 'GEMINI',
        gemini_api_key: configMap['gemini_api_key'] || '',
        custom_ai_url: configMap['custom_ai_url'] || '',
        custom_ai_key: configMap['custom_ai_key'] || '',
        // Integration Config
        monitored_accounts: configMap['monitored_accounts'] || 'user@example.com',
        sync_since_date: configMap['sync_since_date'] || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), // last 7 days default
        sync_interval_minutes: configMap['sync_interval_minutes'] || '30',
        exchange_enabled: configMap['exchange_enabled'] || 'true',
        teams_enabled: configMap['teams_enabled'] || 'true',
      }
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'ADMIN') {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    const body = await request.json();
    const {
      ai_provider, gemini_api_key, custom_ai_url, custom_ai_key,
      monitored_accounts, sync_since_date, sync_interval_minutes,
      exchange_enabled, teams_enabled
    } = body;

    const dataToSave = [
      { key: 'ai_provider', value: ai_provider || 'GEMINI' },
      { key: 'gemini_api_key', value: gemini_api_key || '' },
      { key: 'custom_ai_url', value: custom_ai_url || '' },
      { key: 'custom_ai_key', value: custom_ai_key || '' },
      { key: 'monitored_accounts', value: monitored_accounts || 'user@example.com' },
      { key: 'sync_since_date', value: sync_since_date || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) },
      { key: 'sync_interval_minutes', value: String(sync_interval_minutes || '30') },
      { key: 'exchange_enabled', value: String(exchange_enabled ?? 'true') },
      { key: 'teams_enabled', value: String(teams_enabled ?? 'true') },
    ];

    for (const item of dataToSave) {
      await prisma.systemConfig.upsert({
        where: { key: item.key },
        update: { value: item.value },
        create: { key: item.key, value: item.value }
      });
    }

    // Audit log
    try {
      const admin = await prisma.supportUser.findFirst({ where: { role: 'ADMIN' } });
      if (admin) {
        await prisma.auditLog.create({
          data: {
            userId: admin.id,
            action: 'SETTINGS_UPDATE',
            details: 'Configurações de IA, integração e contas de monitoramento atualizadas pelo Administrador.'
          }
        });
      }
    } catch (auditError) {
      console.error('Settings audit log error (non-critical):', auditError);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
