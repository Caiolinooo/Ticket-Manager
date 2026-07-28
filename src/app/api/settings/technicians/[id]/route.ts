import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  normalizeReceiveMode,
  parseStringArray,
  requireAdmin,
  serializeStringArray,
  toTechnicianDto,
  validateEmailList,
} from '../_helpers';

const technicianSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  monitoredEmails: true,
  monitoredTeamsAccounts: true,
  receiveMode: true,
  active: true,
  createdAt: true,
  portalUserId: true,
  authSource: true,
} as const;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const { id } = await context.params;
    const user = await prisma.supportUser.findFirst({
      where: { id, role: 'TECHNICIAN' },
      select: technicianSelect,
    });
    if (!user) {
      return NextResponse.json({ success: false, error: 'Técnico não encontrado' }, { status: 404 });
    }
    return NextResponse.json({ success: true, technician: toTechnicianDto(user) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro interno';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { session, error } = await requireAdmin();
    if (error) return error;

    const { id } = await context.params;
    const existing = await prisma.supportUser.findFirst({
      where: { id, role: 'TECHNICIAN' },
      select: technicianSelect,
    });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Técnico não encontrado' }, { status: 404 });
    }

    const body = await request.json();
    const data: {
      monitoredEmails?: string;
      monitoredTeamsAccounts?: string;
      receiveMode?: string;
      active?: boolean;
      name?: string;
    } = {};

    // Name/email/password come from Portal — allow optional name sync only
    if (body.name !== undefined) {
      const name = String(body.name || '').trim();
      if (!name) {
        return NextResponse.json({ success: false, error: 'Nome é obrigatório' }, { status: 400 });
      }
      data.name = name;
    }

    if (body.monitoredEmails !== undefined) {
      const serialized = serializeStringArray(body.monitoredEmails);
      const listErr = validateEmailList(JSON.parse(serialized) as string[], 'monitoredEmails');
      if (listErr) {
        return NextResponse.json({ success: false, error: listErr }, { status: 400 });
      }
      data.monitoredEmails = serialized;
    }

    if (body.monitoredTeamsAccounts !== undefined) {
      const serialized = serializeStringArray(body.monitoredTeamsAccounts);
      const listErr = validateEmailList(JSON.parse(serialized) as string[], 'monitoredTeamsAccounts');
      if (listErr) {
        return NextResponse.json({ success: false, error: listErr }, { status: 400 });
      }
      data.monitoredTeamsAccounts = serialized;
    }

    if (body.receiveMode !== undefined) {
      data.receiveMode = normalizeReceiveMode(body.receiveMode);
    }

    if (body.active !== undefined) {
      data.active = Boolean(body.active);
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ success: false, error: 'Nenhum campo para atualizar' }, { status: 400 });
    }

    const updated = await prisma.supportUser.update({
      where: { id },
      data,
      select: technicianSelect,
    });

    try {
      await prisma.auditLog.create({
        data: {
          userId: session!.id,
          action: 'TECHNICIAN_UPDATE',
          details: `Técnico atualizado: ${updated.name} <${updated.email}> (active=${updated.active}, receiveMode=${updated.receiveMode || 'SHARED_WITH_ADMIN'}, emails=${parseStringArray(updated.monitoredEmails).join(',')}).`,
        },
      });
    } catch (auditError) {
      console.error('Technician update audit error (non-critical):', auditError);
    }

    return NextResponse.json({ success: true, technician: toTechnicianDto(updated) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro interno';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/** Soft-deactivate technician (active=false). Does not delete the row. */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { session, error } = await requireAdmin();
    if (error) return error;

    const { id } = await context.params;
    const existing = await prisma.supportUser.findFirst({
      where: { id, role: 'TECHNICIAN' },
      select: { id: true, name: true, email: true },
    });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Técnico não encontrado' }, { status: 404 });
    }

    const updated = await prisma.supportUser.update({
      where: { id },
      data: { active: false },
      select: technicianSelect,
    });

    try {
      await prisma.auditLog.create({
        data: {
          userId: session!.id,
          action: 'TECHNICIAN_DEACTIVATE',
          details: `Técnico desativado: ${existing.name} <${existing.email}>.`,
        },
      });
    } catch (auditError) {
      console.error('Technician deactivate audit error (non-critical):', auditError);
    }

    return NextResponse.json({ success: true, technician: toTechnicianDto(updated) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro interno';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
