import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  getPortalCookieName,
  getSession,
  setSessionCookie,
} from '@/lib/auth';
import { resolvePortalSessionFromToken } from '@/lib/portal-auth';

/**
 * Soft SSO: if a valid EmployeeHub JWT is present (cookie or Bearer),
 * create a Ticket-Manager client session without re-entering password.
 */
export async function POST(request: NextRequest) {
  try {
    const existing = await getSession();
    if (existing) {
      return NextResponse.json({ success: true, user: existing, source: 'session' });
    }

    let token: string | null = null;

    const authHeader = request.headers.get('authorization');
    if (authHeader?.toLowerCase().startsWith('bearer ')) {
      token = authHeader.slice(7).trim();
    }

    if (!token) {
      const cookieStore = await cookies();
      token = cookieStore.get(getPortalCookieName())?.value || null;
    }

    if (!token) {
      try {
        const body = await request.json();
        if (body?.token && typeof body.token === 'string') {
          token = body.token;
        }
      } catch {
        // no body
      }
    }

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Nenhuma sessão do Portal encontrada' },
        { status: 401 }
      );
    }

    const resolved = await resolvePortalSessionFromToken(token);
    if (!resolved.ok) {
      return NextResponse.json(
        { success: false, error: resolved.error },
        { status: resolved.status }
      );
    }

    // Soft-SSO always opens the client area (EMPLOYEE cookie), even if the
    // SupportUser row is also an operator account for the same email.
    const sessionData = {
      id: resolved.employee.id,
      name: resolved.employee.name,
      email: resolved.employee.email,
      role: 'EMPLOYEE' as const,
      authSource: 'portal' as const,
      portalUserId: resolved.portalUser.id,
    };

    await setSessionCookie(sessionData);

    return NextResponse.json({ success: true, user: sessionData, source: 'portal' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro interno';
    console.error('SSO API error:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
