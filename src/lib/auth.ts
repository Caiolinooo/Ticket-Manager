import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
  authSource?: 'local' | 'portal';
  portalUserId?: string;
}

interface SessionJwtPayload extends SessionUser {
  exp?: number;
  iat?: number;
}

const SESSION_COOKIE = 'session';
const DEFAULT_MAX_AGE_SEC = 60 * 60 * 24; // 1 day

export function getSessionSecret(): string {
  const secret =
    process.env.TM_SESSION_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    '';
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('TM_SESSION_SECRET ou JWT_SECRET deve estar definido em produção');
    }
    return 'dev-only-session-secret';
  }
  return secret;
}

export function signSession(user: SessionUser, maxAgeSec = DEFAULT_MAX_AGE_SEC): string {
  return jwt.sign(
    {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      authSource: user.authSource || 'local',
      portalUserId: user.portalUserId,
    },
    getSessionSecret(),
    { expiresIn: maxAgeSec }
  );
}

export function verifySessionToken(token: string): SessionUser | null {
  try {
    const payload = jwt.verify(token, getSessionSecret()) as SessionJwtPayload;
    if (!payload?.id || !payload?.email || !payload?.role) return null;
    return {
      id: payload.id,
      name: payload.name,
      email: payload.email,
      role: payload.role,
      authSource: payload.authSource,
      portalUserId: payload.portalUserId,
    };
  } catch {
    return null;
  }
}

/** Legacy base64 JSON session (pre-1.2.0) — accepted once, then re-signed on write paths. */
function parseLegacySession(raw: string): SessionUser | null {
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf-8');
    const data = JSON.parse(decoded) as SessionUser;
    if (!data?.id || !data?.email || !data?.role) return null;
    return {
      id: data.id,
      name: data.name,
      email: data.email,
      role: data.role,
      authSource: 'local',
    };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionUser | null> {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE);

    if (!sessionCookie?.value) {
      return null;
    }

    const jwtSession = verifySessionToken(sessionCookie.value);
    if (jwtSession) return jwtSession;

    return parseLegacySession(sessionCookie.value);
  } catch {
    return null;
  }
}

export async function setSessionCookie(
  user: SessionUser,
  maxAgeSec = DEFAULT_MAX_AGE_SEC
): Promise<void> {
  const token = signSession(user, maxAgeSec);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: maxAgeSec,
    path: '/',
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export function getPortalCookieName(): string {
  return process.env.PORTAL_JWT_COOKIE?.trim() || 'abzToken';
}
