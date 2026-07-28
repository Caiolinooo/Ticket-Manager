import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { prisma } from '@/lib/db';

export interface PortalUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  active: boolean;
  isAuthorized: boolean;
  authorizationStatus: string | null;
  password: string | null;
  passwordHash: string | null;
}

export interface PortalAuthResult {
  ok: true;
  user: PortalUser;
  displayName: string;
}

export interface PortalAuthFailure {
  ok: false;
  error: string;
  status: number;
}

type PortalAuthOutcome = PortalAuthResult | PortalAuthFailure;

interface PortalJwtPayload {
  userId?: string;
  phoneNumber?: string;
  role?: string;
  exp?: number;
}

const BLOCKED_AUTH_STATUSES = new Set([
  'pending',
  'blocked',
  'denied',
  'rejected',
  'inactive',
  'disabled',
]);

function getPool(): Pool {
  return new Pool({ connectionString: process.env.DATABASE_URL });
}

function normalizeHashedPassword(user: Pick<PortalUser, 'password' | 'passwordHash'>): string | null {
  return user.password || user.passwordHash || null;
}

function displayName(user: PortalUser): string {
  const name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
  return name || user.email;
}

function isPortalUserAllowed(user: PortalUser): PortalAuthFailure | null {
  if (!user.active) {
    return {
      ok: false,
      error: 'Sua conta está desativada. Entre em contato com o suporte.',
      status: 403,
    };
  }

  const status = (user.authorizationStatus || '').toLowerCase();
  if (BLOCKED_AUTH_STATUSES.has(status) && !user.isAuthorized) {
    return {
      ok: false,
      error: 'Sua conta ainda não está autorizada no Portal. Entre em contato com o suporte.',
      status: 403,
    };
  }

  if (!user.isAuthorized && status && status !== 'active') {
    return {
      ok: false,
      error: 'Sua conta ainda não está autorizada no Portal. Entre em contato com o suporte.',
      status: 403,
    };
  }

  return null;
}

function mapRow(row: Record<string, unknown>): PortalUser {
  return {
    id: String(row.id),
    email: String(row.email || ''),
    firstName: String(row.first_name || ''),
    lastName: String(row.last_name || ''),
    role: String(row.role || 'USER'),
    active: Boolean(row.active),
    isAuthorized: Boolean(row.is_authorized),
    authorizationStatus: row.authorization_status == null ? null : String(row.authorization_status),
    password: row.password == null ? null : String(row.password),
    passwordHash: row.password_hash == null ? null : String(row.password_hash),
  };
}

export async function findPortalUserByEmail(email: string): Promise<PortalUser | null> {
  const pool = getPool();
  try {
    const result = await pool.query(
      `
      SELECT id, email, first_name, last_name, role, active, is_authorized,
             authorization_status, password, password_hash
      FROM public.users_unified
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1
      `,
      [email.trim()]
    );
    if (result.rows.length === 0) return null;
    return mapRow(result.rows[0]);
  } finally {
    await pool.end();
  }
}

export async function findPortalUserById(id: string): Promise<PortalUser | null> {
  const pool = getPool();
  try {
    const result = await pool.query(
      `
      SELECT id, email, first_name, last_name, role, active, is_authorized,
             authorization_status, password, password_hash
      FROM public.users_unified
      WHERE id = $1
      LIMIT 1
      `,
      [id]
    );
    if (result.rows.length === 0) return null;
    return mapRow(result.rows[0]);
  } finally {
    await pool.end();
  }
}

export async function authenticatePortalUser(
  email: string,
  password: string
): Promise<PortalAuthOutcome> {
  const user = await findPortalUserByEmail(email);
  if (!user) {
    return { ok: false, error: 'Credenciais inválidas', status: 401 };
  }

  const denied = isPortalUserAllowed(user);
  if (denied) return denied;

  const hash = normalizeHashedPassword(user);
  if (!hash) {
    return {
      ok: false,
      error: 'Este usuário não tem senha definida no Portal. Defina a senha no Portal e tente novamente.',
      status: 401,
    };
  }

  const valid = await bcrypt.compare(password, hash);
  if (!valid) {
    return { ok: false, error: 'Credenciais inválidas', status: 401 };
  }

  return { ok: true, user, displayName: displayName(user) };
}

export function getPortalJwtSecret(): string | null {
  return process.env.JWT_SECRET?.trim() || null;
}

export function verifyPortalJwt(token: string): PortalJwtPayload | null {
  const secret = getPortalJwtSecret();
  if (!secret) return null;

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = jwt.verify(token, secret) as PortalJwtPayload;
    if (!payload?.userId) return null;
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Ensures a ticket_support.SupportUser exists for a Portal employee.
 * Portal staff always map to EMPLOYEE in Ticket-Manager (admin area keeps local auth).
 */
export async function ensureEmployeeFromPortal(user: PortalUser) {
  const email = user.email.trim().toLowerCase();
  const name = displayName(user);

  const existing = await prisma.supportUser.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
  });
  if (existing) {
    // Do not downgrade local operators (ADMIN / TECHNICIAN / legacy AGENT) to EMPLOYEE.
    const op = (existing.role || '').toUpperCase();
    if (op === 'ADMIN' || op === 'TECHNICIAN' || op === 'AGENT') {
      return existing;
    }
    if (existing.name !== name) {
      return prisma.supportUser.update({
        where: { id: existing.id },
        data: { name },
      });
    }
    return existing;
  }

  return prisma.supportUser.create({
    data: {
      email,
      name,
      role: 'EMPLOYEE',
      passwordHash: 'portal-auth',
    },
  });
}

export async function resolvePortalSessionFromToken(token: string) {
  const payload = verifyPortalJwt(token);
  if (!payload?.userId) {
    return { ok: false as const, error: 'Sessão do Portal inválida ou expirada', status: 401 };
  }

  const portalUser = await findPortalUserById(payload.userId);
  if (!portalUser) {
    return { ok: false as const, error: 'Usuário do Portal não encontrado', status: 401 };
  }

  const denied = isPortalUserAllowed(portalUser);
  if (denied) return denied;

  if (!portalUser.email) {
    return { ok: false as const, error: 'Usuário do Portal sem e-mail', status: 400 };
  }

  const employee = await ensureEmployeeFromPortal(portalUser);
  return {
    ok: true as const,
    portalUser,
    employee,
    displayName: displayName(portalUser),
  };
}
