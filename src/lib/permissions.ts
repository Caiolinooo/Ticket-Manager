/**
 * Operator permission matrix (ADMIN vs TECHNICIAN) — client-safe (no Prisma/DB).
 *
 * Roles on SupportUser.role (string):
 *   ADMIN | TECHNICIAN | EMPLOYEE
 *   AGENT — legacy alias treated as TECHNICIAN
 *
 * Routing fields (Foundation): receiveMode SHARED_WITH_ADMIN | OWN_ONLY
 * List filters that need DB live in technician-routing.ts (server only).
 */

import type { SessionUser } from '@/lib/auth';

export type SupportRole = 'ADMIN' | 'TECHNICIAN' | 'AGENT' | 'EMPLOYEE';

/** How a technician receives pendências — persisted on SupportUser.receiveMode. */
export type ReceiveMode = 'SHARED_WITH_ADMIN' | 'OWN_ONLY';

export interface TechnicianAccessContext {
  receiveMode?: ReceiveMode;
  /** Visible mailbox UPNs from routing (own or own∪admin). */
  visibleAccounts?: string[] | null;
  monitoredAccounts?: string[];
}

export interface TicketAccessInput {
  id: string;
  createdById: string;
  assignedToId?: string | null;
  category?: string | null;
  source?: string | null;
  accountUpn?: string | null;
}

export function normalizeRole(role: string | null | undefined): SupportRole | string {
  return (role || '').toUpperCase();
}

export function isAdminRole(role: string | null | undefined): boolean {
  return normalizeRole(role) === 'ADMIN';
}

/** TECHNICIAN or legacy AGENT. */
export function isTechnicianRole(role: string | null | undefined): boolean {
  const r = normalizeRole(role);
  return r === 'TECHNICIAN' || r === 'AGENT';
}

/** Local operator area: ADMIN | TECHNICIAN | AGENT (legacy). */
export function isOperatorRole(role: string | null | undefined): boolean {
  return isAdminRole(role) || isTechnicianRole(role);
}

export function isEmployeeRole(role: string | null | undefined): boolean {
  return normalizeRole(role) === 'EMPLOYEE';
}

export function canAccessOperatorArea(user: Pick<SessionUser, 'role'> | null | undefined): boolean {
  return !!user && isOperatorRole(user.role);
}

/** System settings (AI keys, monitored_accounts, sync interval, feature flags). */
export function canManageSettings(user: Pick<SessionUser, 'role'> | null | undefined): boolean {
  return !!user && isAdminRole(user.role);
}

/** CRUD of technicians / operator accounts. */
export function canManageTechnicians(user: Pick<SessionUser, 'role'> | null | undefined): boolean {
  return !!user && isAdminRole(user.role);
}

/**
 * Microsoft Graph global sync (Teams/Exchange collect).
 * Write/trigger: ADMIN only. Technicians still see/approve pending traces.
 */
export function canSyncMicrosoft(user: Pick<SessionUser, 'role'> | null | undefined): boolean {
  return !!user && isAdminRole(user.role);
}

/** List assignees for ticket assignment UI (operators may read). */
export function canListOperators(user: Pick<SessionUser, 'role'> | null | undefined): boolean {
  return canAccessOperatorArea(user);
}

export function canApproveIntegrations(user: Pick<SessionUser, 'role'> | null | undefined): boolean {
  return canAccessOperatorArea(user);
}

export function canUpdateAnyTicket(user: Pick<SessionUser, 'role'> | null | undefined): boolean {
  return canAccessOperatorArea(user);
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Pure mailbox match — used by canAccessTicket (client + server). */
export function accountMatchesVisible(
  accountUpn: string | null | undefined,
  visibleAccounts: string[] | null,
  receiveMode: ReceiveMode | 'ADMIN' = 'ADMIN'
): boolean {
  if (visibleAccounts === null) return true;
  if (visibleAccounts.length === 0) return false;

  const upn = accountUpn ? normalizeEmail(accountUpn) : null;
  if (upn && visibleAccounts.includes(upn)) return true;

  if (!upn && receiveMode !== 'OWN_ONLY') return true;
  return false;
}

/**
 * Ticket visibility for a user (work queue — not KPI).
 * EMPLOYEE: own tickets only.
 * ADMIN: all.
 * TECHNICIAN: filtered by receiveMode + visibleAccounts when provided.
 */
export function canAccessTicket(
  user: Pick<SessionUser, 'id' | 'role'> | null | undefined,
  ticket: TicketAccessInput,
  ctx: TechnicianAccessContext = {}
): boolean {
  if (!user) return false;

  if (isEmployeeRole(user.role)) {
    return ticket.createdById === user.id;
  }

  if (isAdminRole(user.role)) {
    return true;
  }

  if (!isTechnicianRole(user.role)) {
    return false;
  }

  const mode: ReceiveMode = ctx.receiveMode || 'SHARED_WITH_ADMIN';
  const visible = ctx.visibleAccounts ?? ctx.monitoredAccounts ?? null;

  if (visible === null) {
    return true;
  }

  if (accountMatchesVisible(ticket.accountUpn, visible, mode)) {
    return true;
  }

  if (mode === 'OWN_ONLY' && ticket.assignedToId === user.id) {
    return true;
  }

  return false;
}

/**
 * Prisma `where` fragment for operator ticket work lists.
 * Prefer technician-routing.ticketWhereForAccounts for full logic on server.
 */
export function ticketWhereForOperator(
  user: Pick<SessionUser, 'id' | 'role'>,
  ctx: TechnicianAccessContext = {}
): Record<string, unknown> {
  if (isAdminRole(user.role)) {
    return {};
  }

  if (!isTechnicianRole(user.role)) {
    return { id: '__none__' };
  }

  const visible = ctx.visibleAccounts ?? ctx.monitoredAccounts;
  if (visible === undefined || visible === null) {
    return {};
  }
  if (visible.length === 0) {
    return { id: '__none__' };
  }

  const mode: ReceiveMode = ctx.receiveMode || 'SHARED_WITH_ADMIN';
  switch (mode) {
    case 'OWN_ONLY':
      return {
        OR: [
          { accountUpn: { in: visible } },
          { assignedToId: user.id },
        ],
      };
    case 'SHARED_WITH_ADMIN':
      return {
        OR: [
          { accountUpn: { in: visible } },
          { accountUpn: null },
        ],
      };
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

/** Human labels for UI badges. */
export function roleDisplayLabel(role: string | null | undefined): string {
  if (isAdminRole(role)) return 'Administrador';
  if (isTechnicianRole(role)) return 'Técnico';
  if (isEmployeeRole(role)) return 'Cliente';
  return role || 'Usuário';
}

/** Documented ADMIN vs TECHNICIAN matrix (see tasks.md §9b). */
export const PERMISSION_MATRIX = {
  operatorLogin: { ADMIN: true, TECHNICIAN: true },
  viewUpdateTickets: { ADMIN: true, TECHNICIAN: true },
  approvePending: { ADMIN: true, TECHNICIAN: true },
  kpisExport: { ADMIN: true, TECHNICIAN: true },
  systemSettings: { ADMIN: true, TECHNICIAN: false },
  crudTechnicians: { ADMIN: true, TECHNICIAN: false },
  microsoftSync: { ADMIN: true, TECHNICIAN: false },
} as const;

