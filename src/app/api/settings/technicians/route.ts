import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  hashPassword,
  isValidEmail,
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

export async function POST(request: Request) {
  try {
    const { session, error } = await requireAdmin();
    if (error) return error;

    const body = await request.json();
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const monitoredEmails = serializeStringArray(body.monitoredEmails);
    const monitoredTeamsAccounts = serializeStringArray(body.monitoredTeamsAccounts);
    const receiveMode = normalizeReceiveMode(body.receiveMode);
    const active = body.active === false ? false : true;

    if (!name) {
      return NextResponse.json({ success: false, error: 'Nome é obrigatório' }, { status: 400 });
    }
    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ success: false, error: 'E-mail de login inválido' }, { status: 400 });
    }
    if (!password || password.length < 6) {
      return NextResponse.json(
        { success: false, error: 'Senha obrigatória (mínimo 6 caracteres)' },
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

    const existing = await prisma.supportUser.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
    if (existing) {
      return NextResponse.json(
        { success: false, error: 'Já existe um usuário com este e-mail' },
        { status: 409 }
      );
    }

    const created = await prisma.supportUser.create({
      data: {
        name,
        email,
        passwordHash: hashPassword(password),
        role: 'TECHNICIAN',
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
          details: `Técnico criado: ${created.name} <${created.email}> (receiveMode=${receiveMode}).`,
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
