/**
 * Technician routing — mailbox/Teams visibility + Graph sync account union.
 * SERVER-ONLY (uses Prisma). Do not import from client components.
 *
 * Visibility (pendências / tickets de trabalho):
 *   ADMIN              → tudo
 *   OWN_ONLY           → só contas do técnico
 *   SHARED_WITH_ADMIN  → contas do técnico ∪ contas globais do admin
 *
 * KPI / dashboard / export: sempre agregação do setor inteiro (não usa estes filtros).
 */

import { prisma } from '@/lib/db';
import type { ReceiveMode } from '@/lib/permissions';
import { accountMatchesVisible } from '@/lib/permissions';

export type TechnicianReceiveMode = ReceiveMode;

export interface TechnicianRoutingProfile {
  id: string;
  role: string;
  receiveMode: TechnicianReceiveMode;
  monitoredEmails: string[];
  monitoredTeamsAccounts: string[];
  active: boolean;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isAdminRole(role: string | null | undefined): boolean {
  return (role || '').toUpperCase() === 'ADMIN';
}

function isTechnicianRole(role: string | null | undefined): boolean {
  const r = (role || '').toUpperCase();
  return r === 'TECHNICIAN' || r === 'AGENT';
}

export function parseJsonStringArray(raw: string | null | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((v) => normalizeEmail(String(v))).filter(Boolean);
    }
  } catch {
    // comma-separated fallback
  }
  return raw
    .split(',')
    .map((v) => normalizeEmail(v))
    .filter(Boolean);
}

export function normalizeReceiveMode(raw: string | null | undefined): TechnicianReceiveMode {
  return raw === 'OWN_ONLY' ? 'OWN_ONLY' : 'SHARED_WITH_ADMIN';
}

export async function getAdminMonitoredAccounts(): Promise<string[]> {
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key: 'monitored_accounts' } });
    const raw = row?.value || 'user@example.com';
    return raw
      .split(',')
      .map((e) => normalizeEmail(e))
      .filter(Boolean);
  } catch (err) {
    console.error('[routing] Failed to read monitored_accounts:', err);
    return ['user@example.com'];
  }
}

/** Active technicians (TECHNICIAN + legacy AGENT) with mailbox config. */
export async function listActiveTechnicianProfiles(): Promise<TechnicianRoutingProfile[]> {
  const users = await prisma.supportUser.findMany({
    where: {
      role: { in: ['TECHNICIAN', 'AGENT'] },
      active: true,
    },
    select: {
      id: true,
      role: true,
      receiveMode: true,
      monitoredEmails: true,
      monitoredTeamsAccounts: true,
      active: true,
    },
  });

  return users.map((u) => ({
    id: u.id,
    role: u.role,
    receiveMode: normalizeReceiveMode(u.receiveMode),
    monitoredEmails: parseJsonStringArray(u.monitoredEmails),
    monitoredTeamsAccounts: parseJsonStringArray(u.monitoredTeamsAccounts),
    active: u.active,
  }));
}

export async function getTechnicianProfile(userId: string): Promise<TechnicianRoutingProfile | null> {
  const u = await prisma.supportUser.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      receiveMode: true,
      monitoredEmails: true,
      monitoredTeamsAccounts: true,
      active: true,
    },
  });
  if (!u) return null;
  return {
    id: u.id,
    role: u.role,
    receiveMode: normalizeReceiveMode(u.receiveMode),
    monitoredEmails: parseJsonStringArray(u.monitoredEmails),
    monitoredTeamsAccounts: parseJsonStringArray(u.monitoredTeamsAccounts),
    active: u.active !== false,
  };
}

/**
 * Union of admin global accounts + all active technicians' accounts.
 * Used by Graph sync so the sector never misses a mailbox.
 */
export async function getSyncAccountUnion(): Promise<{
  adminAccounts: string[];
  exchangeAccounts: string[];
  teamsAccounts: string[];
  allAccounts: string[];
}> {
  const adminAccounts = await getAdminMonitoredAccounts();
  const techs = await listActiveTechnicianProfiles();

  const techEmails = techs.flatMap((t) => t.monitoredEmails);
  const techTeams = techs.flatMap((t) => t.monitoredTeamsAccounts);

  const exchangeAccounts = uniqueEmails([...adminAccounts, ...techEmails]);
  const teamsAccounts = uniqueEmails([...adminAccounts, ...techTeams]);
  const allAccounts = uniqueEmails([...exchangeAccounts, ...teamsAccounts]);

  return { adminAccounts, exchangeAccounts, teamsAccounts, allAccounts };
}

function uniqueEmails(list: string[]): string[] {
  return Array.from(new Set(list.map(normalizeEmail).filter(Boolean)));
}

/**
 * Account UPNs a technician may see for pendências/tickets.
 * ADMIN → null (no filter / see all).
 */
export async function getVisibleAccountUpnsForUser(user: {
  id: string;
  role: string;
}): Promise<string[] | null> {
  if (isAdminRole(user.role)) return null;

  if (!isTechnicianRole(user.role)) {
    return [];
  }

  const profile = await getTechnicianProfile(user.id);
  if (!profile || !profile.active) return [];

  const own = uniqueEmails([
    ...profile.monitoredEmails,
    ...profile.monitoredTeamsAccounts,
  ]);

  if (profile.receiveMode === 'OWN_ONLY') {
    return own;
  }

  const adminAccounts = await getAdminMonitoredAccounts();
  return uniqueEmails([...own, ...adminAccounts]);
}

/**
 * Prisma where for ExternalTrace list (pending).
 */
export function externalTraceWhereForAccounts(
  visibleAccounts: string[] | null,
  receiveMode: TechnicianReceiveMode | 'ADMIN' = 'ADMIN'
): Record<string, unknown> {
  if (visibleAccounts === null) return {};

  if (visibleAccounts.length === 0) {
    return { id: '__none__' };
  }

  if (receiveMode === 'OWN_ONLY') {
    return { accountUpn: { in: visibleAccounts } };
  }

  return {
    OR: [
      { accountUpn: { in: visibleAccounts } },
      { accountUpn: null },
    ],
  };
}

/**
 * Prisma where for Ticket work queue (not KPI).
 */
export function ticketWhereForAccounts(
  visibleAccounts: string[] | null,
  receiveMode: TechnicianReceiveMode | 'ADMIN' = 'ADMIN',
  userId?: string
): Record<string, unknown> {
  if (visibleAccounts === null) return {};

  if (visibleAccounts.length === 0) {
    return { id: '__none__' };
  }

  if (receiveMode === 'OWN_ONLY') {
    const ownClause: Record<string, unknown>[] = [
      { accountUpn: { in: visibleAccounts } },
    ];
    if (userId) {
      ownClause.push({ assignedToId: userId });
    }
    return { OR: ownClause };
  }

  return {
    OR: [
      { accountUpn: { in: visibleAccounts } },
      { accountUpn: null },
    ],
  };
}

export { accountMatchesVisible };
