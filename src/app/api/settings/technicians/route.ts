import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  findPortalUserByEmail,
  findPortalUserById,
  portalDisplayName,
  PORTAL_AUTH_MARKER,
} from '@/lib/portal-auth';
import {
  normalizeReceiveMode,
  requireAdmin,
  serializeStringArray,
  toTechnicianDto,
  validateEmailList,
} from './_helpers';

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

export async function GET() {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const users = await prisma.supportUser.findMany({
      where: { role: 'TECHNICIAN' },
      select: technicianSelect,
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });

    return NextResponse.json({
      success: true,
      technicians: users.map(toTechnicianDto),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro interno';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/**
 * Create technician from a Portal user (no local password).
 * Body: { portalUserId | email, monitoredEmails?, monitoredTeamsAccounts?, receiveMode?, active? }
 */
export async function POST(request: Request) {
  try {
    const { session, error } = await requireAdmin();
    if (error) return error;

    const body = await request.json();
    const portalUserId = body.portalUserId ? String(body.portalUserId).trim() : '';
    const emailHint = body.email ? String(body.email).trim().toLowerCase() : '';
    const monitoredEmails = serializeStringArray(body.monitoredEmails);
    const monitoredTeamsAccounts = serializeStringArray(body.monitoredTeamsAccounts);
    const receiveMode = normalizeReceiveMode(body.receiveMode);
    const active = body.active === false ? false : true;

    if (!portalUserId && !emailHint) {
      return NextResponse.json(
        { success: false, error: 'Selecione um usuário do Portal (portalUserId ou email)' },
        { status: 400 }
      );
    }

    const emailsErr = validateEmailList(JSON.parse(monitoredEmails) as string[], 'monitoredEmails');
    if (emailsErr) {
      return NextResponse.json({ success: false, error: emailsErr }, { status: 400 });
    }
    const teamsErr = validateEmailList(
      JSON.parse(monitoredTeamsAccounts) as string[],
      'monitoredTeamsAccounts'
    );
    if (teamsErr) {
      return NextResponse.json({ success: false, error: teamsErr }, { status: 400 });
    }

    const portalUser = portalUserId
      ? await findPortalUserById(portalUserId)
      : await findPortalUserByEmail(emailHint);

    if (!portalUser || !portalUser.email) {
      return NextResponse.json(
        { success: false, error: 'Usuário do Portal não encontrado' },
        { status: 404 }
      );
    }
    if (!portalUser.active) {
      return NextResponse.json(
        { success: false, error: 'Usuário do Portal está desativado' },
        { status: 400 }
      );
    }

    const email = portalUser.email.trim().toLowerCase();
    const name = portalDisplayName(portalUser);

    const existing = await prisma.supportUser.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });

    if (existing) {
      const role = (existing.role || '').toUpperCase();
      if (role === 'ADMIN') {
        return NextResponse.json(
          { success: false, error: 'Este e-mail pertence a um administrador local' },
          { status: 409 }
        );
      }
      if (role === 'TECHNICIAN' || role === 'AGENT') {
        return NextResponse.json(
          { success: false, error: 'Já existe um técnico com este e-mail' },
          { status: 409 }
        );
      }

      // Promote EMPLOYEE (or other) → TECHNICIAN linked to Portal
      const promoted = await prisma.supportUser.update({
        where: { id: existing.id },
        data: {
          name,
          role: 'TECHNICIAN',
          passwordHash: PORTAL_AUTH_MARKER,
          portalUserId: portalUser.id,
          authSource: 'portal',
          monitoredEmails,
          monitoredTeamsAccounts,
          receiveMode,
          active,
        },
        select: technicianSelect,
      });

      try {
        await prisma.auditLog.create({
          data: {
            userId: session!.id,
            action: 'TECHNICIAN_CREATE',
            details: `Técnico promovido do Portal: ${promoted.name} <${promoted.email}> (portalUserId=${portalUser.id}, receiveMode=${receiveMode}).`,
          },
        });
      } catch (auditError) {
        console.error('Technician create audit error (non-critical):', auditError);
      }

      return NextResponse.json({ success: true, technician: toTechnicianDto(promoted) }, { status: 201 });
    }

    const created = await prisma.supportUser.create({
      data: {
        name,
        email,
        passwordHash: PORTAL_AUTH_MARKER,
        role: 'TECHNICIAN',
        portalUserId: portalUser.id,
        authSource: 'portal',
        monitoredEmails,
        monitoredTeamsAccounts,
        receiveMode,
        active,
      },
      select: technicianSelect,
    });

    try {
      await prisma.auditLog.create({
        data: {
          userId: session!.id,
          action: 'TECHNICIAN_CREATE',
          details: `Técnico criado do Portal: ${created.name} <${created.email}> (portalUserId=${portalUser.id}, receiveMode=${receiveMode}).`,
        },
      });
    } catch (auditError) {
      console.error('Technician create audit error (non-critical):', auditError);
    }

    return NextResponse.json({ success: true, technician: toTechnicianDto(created) }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro interno';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
