import { NextResponse } from 'next/server';
import * as crypto from 'crypto';
import { prisma } from '@/lib/db';
import { setSessionCookie } from '@/lib/auth';
import {
  authenticatePortalUser,
  ensureEmployeeFromPortal,
} from '@/lib/portal-auth';

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: 'E-mail e senha são obrigatórios' },
        { status: 400 }
      );
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const localUser = await prisma.supportUser.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
    });

    // Admin / Agent: local Ticket-Manager credentials only
    if (localUser && (localUser.role === 'ADMIN' || localUser.role === 'AGENT')) {
      const passwordHash = hashPassword(password);
      if (localUser.passwordHash !== passwordHash) {
        return NextResponse.json(
          { success: false, error: 'Credenciais inválidas' },
          { status: 401 }
        );
      }

      const sessionData = {
        id: localUser.id,
        name: localUser.name,
        email: localUser.email,
        role: localUser.role,
        authSource: 'local' as const,
      };

      await setSessionCookie(sessionData);

      try {
        await prisma.auditLog.create({
          data: {
            userId: localUser.id,
            action: 'LOGIN',
            details: `Usuário ${localUser.name} logou no sistema (local).`,
          },
        });
      } catch (auditError) {
        console.error('Login audit log error (non-critical):', auditError);
      }

      return NextResponse.json({ success: true, user: sessionData });
    }

    // Client / Employee: EmployeeHub / Portal credentials (public.users_unified)
    const portal = await authenticatePortalUser(normalizedEmail, password);
    if (!portal.ok) {
      return NextResponse.json(
        { success: false, error: portal.error },
        { status: portal.status }
      );
    }

    if (localUser && (localUser.role === 'ADMIN' || localUser.role === 'AGENT')) {
      return NextResponse.json(
        {
          success: false,
          error: 'Esta conta é de operador. Use as credenciais administrativas do Ticket-Manager.',
        },
        { status: 403 }
      );
    }

    const employee = await ensureEmployeeFromPortal(portal.user);

    if (employee.role === 'ADMIN' || employee.role === 'AGENT') {
      return NextResponse.json(
        {
          success: false,
          error: 'Esta conta é de operador. Use as credenciais administrativas do Ticket-Manager.',
        },
        { status: 403 }
      );
    }

    const sessionData = {
      id: employee.id,
      name: employee.name,
      email: employee.email,
      role: 'EMPLOYEE',
      authSource: 'portal' as const,
      portalUserId: portal.user.id,
    };

    await setSessionCookie(sessionData);

    try {
      await prisma.auditLog.create({
        data: {
          userId: employee.id,
          action: 'LOGIN',
          details: `Usuário ${employee.name} logou via Portal (EmployeeHub).`,
        },
      });
    } catch (auditError) {
      console.error('Login audit log error (non-critical):', auditError);
    }

    return NextResponse.json({ success: true, user: sessionData });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro interno';
    console.error('Login API error:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
