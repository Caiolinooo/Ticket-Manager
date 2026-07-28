import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { canManageTechnicians } from '@/lib/permissions';

export const RECEIVE_MODES = ['SHARED_WITH_ADMIN', 'OWN_ONLY'] as const;
export type ReceiveMode = (typeof RECEIVE_MODES)[number];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((v) => String(v).trim().toLowerCase())
      .filter(Boolean);
  } catch {
    // fallback: comma-separated
    return raw
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
  }
}

export function serializeStringArray(values: unknown): string {
  const list = Array.isArray(values)
    ? values.map((v) => String(v).trim().toLowerCase()).filter(Boolean)
    : typeof values === 'string'
      ? values
          .split(',')
          .map((v) => v.trim().toLowerCase())
          .filter(Boolean)
      : [];
  return JSON.stringify(list);
}

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim().toLowerCase());
}

export function normalizeReceiveMode(raw: unknown): ReceiveMode {
  if (raw === 'OWN_ONLY') return 'OWN_ONLY';
  return 'SHARED_WITH_ADMIN';
}

export function toTechnicianDto(user: {
  id: string;
  name: string;
  email: string;
  role: string;
  monitoredEmails: string | null;
  monitoredTeamsAccounts: string | null;
  receiveMode: string | null;
  active: boolean;
  createdAt: Date;
  portalUserId?: string | null;
  authSource?: string | null;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    monitoredEmails: parseStringArray(user.monitoredEmails),
    monitoredTeamsAccounts: parseStringArray(user.monitoredTeamsAccounts),
    receiveMode: (user.receiveMode === 'OWN_ONLY' ? 'OWN_ONLY' : 'SHARED_WITH_ADMIN') as ReceiveMode,
    active: user.active,
    createdAt: user.createdAt.toISOString(),
    portalUserId: user.portalUserId || null,
    authSource: user.authSource === 'portal' ? 'portal' : user.authSource || 'local',
  };
}

export async function requireAdmin() {
  const session = await getSession();
  if (!canManageTechnicians(session)) {
    return {
      session: null as null,
      error: NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 }),
    };
  }
  return { session, error: null as null };
}

/** Validate list of emails; returns error message or null. */
export function validateEmailList(list: string[], label: string): string | null {
  for (const email of list) {
    if (!isValidEmail(email)) {
      return `${label}: e-mail inválido (${email})`;
    }
  }
  return null;
}
