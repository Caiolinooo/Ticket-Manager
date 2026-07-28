import { NextResponse } from 'next/server';
import * as crypto from 'crypto';
import { prisma } from '@/lib/db';
import { setSessionCookie } from '@/lib/auth';
import {
  authenticatePortalUser,
  ensureEmployeeFromPortal,
  PORTAL_AUTH_MARKER,
} from '@/lib/portal-auth';
import { isOperatorRole, isTechnicianRole } from '@/lib/permissions';

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

type LoginArea = 'client' | 'admin' | 'auto';

function normalizeArea(raw: unknown): LoginArea {
  if (raw === 'client' || raw === 'admin' || raw === 'auto') return raw;
  return 'auto';
}

function usesPortalOperatorAuth(localUser: { role: string }): boolean {
  // TECHNICIAN / legacy AGENT always authenticate via Portal bcrypt
  return isTechnicianRole(localUser.role);
}

async function loginLocalOperator(normalizedEmail: string, password: string) {
  const localUser = await prisma.supportUser.findFirst({
    where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
  });

  if (!localUser || !isOperatorRole(localUser.role)) {
    return {
      ok: false as const,
      status: 401,
      error: 'Credenciais de operador inválidas',
    };
  }

  // Foundation field: inactive technicians cannot open operator sessions.
  if ('active' in localUser && localUser.active === false) {
    return {
      ok: false as const,
      status: 403,
      error: 'Conta de operador desativada. Contate o administrador.',
    };
  }

  // TECHNICIAN: validate password against Portal (bcrypt / users_unified)
  if (usesPortalOperatorAuth(localUser)) {
    const portal = await authenticatePortalUser(normalizedEmail, password);
    if (!portal.ok) {
      return {
        ok: false as const,
        status: portal.status,
        error:
          portal.status === 401
            ? 'Credenciais de operador inválidas (use a senha do Portal)'
            : portal.error,
      };
    }

    // Keep SupportUser name in sync with Portal display name
    if (localUser.name !== portal.displayName || localUser.portalUserId !== portal.user.id) {
      try {
        await prisma.supportUser.update({
          where: { id: localUser.id },
          data: {
            name: portal.displayName,
            portalUserId: portal.user.id,
            authSource: 'portal',
            passwordHash: PORTAL_AUTH_MARKER,
          },
        });
      } catch (syncErr) {
        console.error('Technician portal sync (non-critical):', syncErr);
      }
    }

    const sessionData = {
      id: localUser.id,
      name: portal.displayName || localUser.name,
      email: localUser.email,
      role: localUser.role,
      authSource: 'portal' as const,
      portalUserId: portal.user.id,
    };

    await setSessionCookie(sessionData);

    try {
      await prisma.auditLog.create({
        data: {
          userId: localUser.id,
          action: 'LOGIN',
          details: `Usuário ${sessionData.name} logou no sistema (portal/operador, role=${localUser.role}).`,
        },
      });
    } catch (auditError) {
      console.error('Login audit log error (non-critical):', auditError);
    }

    return { ok: true as const, sessionData };
  }

  // ADMIN (and any non-portal operator): SHA-256 local
  const passwordHash = hashPassword(password);
  if (localUser.passwordHash !== passwordHash) {
    return {
      ok: false as const,
      status: 401,
      error: 'Credenciais inválidas',
    };
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
        details: `Usuário ${localUser.name} logou no sistema (local/operador, role=${localUser.role}).`,
      },
    });
  } catch (auditError) {
    console.error('Login audit log error (non-critical):', auditError);
  }

  return { ok: true as const, sessionData };
}

async function loginPortalClient(normalizedEmail: string, password: string) {
  const portal = await authenticatePortalUser(normalizedEmail, password);
  if (!portal.ok) {
    return {
      ok: false as const,
      status: portal.status,
      error: portal.error,
    };
  }

  const employee = await ensureEmployeeFromPortal(portal.user);

  // Always a client session. If the same email is also a local operator,
  // operators must use area=admin; here we only expose the client role in the cookie.
  const sessionData = {
    id: employee.id,
    name: employee.name || portal.displayName,
    email: employee.email,
    role: 'EMPLOYEE' as const,
    authSource: 'portal' as const,
    portalUserId: portal.user.id,
  };

  await setSessionCookie(sessionData);

  try {
    await prisma.auditLog.create({
      data: {
        userId: employee.id,
        action: 'LOGIN',
        details: `Usuário ${sessionData.name} logou via Portal (EmployeeHub / client).`,
      },
    });
  } catch (auditError) {
    console.error('Login audit log error (non-critical):', auditError);
  }

  return { ok: true as const, sessionData };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = body;
    const area = normalizeArea(body.area);

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: 'E-mail e senha são obrigatórios' },
        { status: 400 }
      );
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    if (area === 'client') {
      const result = await loginPortalClient(normalizedEmail, password);
      if (!result.ok) {
        return NextResponse.json(
          { success: false, error: result.error },
          { status: result.status }
        );
      }
      return NextResponse.json({ success: true, user: result.sessionData });
    }

    if (area === 'admin') {
      const result = await loginLocalOperator(normalizedEmail, password);
      if (!result.ok) {
        return NextResponse.json(
          { success: false, error: result.error },
          { status: result.status }
        );
      }
      return NextResponse.json({ success: true, user: result.sessionData });
    }

    // auto: operators first when local ADMIN/TECHNICIAN/AGENT exists, else Portal client
    const localUser = await prisma.supportUser.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
    });

    if (localUser && isOperatorRole(localUser.role)) {
      const result = await loginLocalOperator(normalizedEmail, password);
      if (result.ok) {
        return NextResponse.json({ success: true, user: result.sessionData });
      }
      // Wrong password — do not silently fall through to Portal for operators
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }

    const portalResult = await loginPortalClient(normalizedEmail, password);
    if (!portalResult.ok) {
      return NextResponse.json(
        { success: false, error: portalResult.error },
        { status: portalResult.status }
      );
    }
    return NextResponse.json({ success: true, user: portalResult.sessionData });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro interno';
    console.error('Login API error:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
