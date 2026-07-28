'use client';

import React from 'react';
import {
  canAccessOperatorArea,
  canManageSettings,
  canManageTechnicians,
  canSyncMicrosoft,
  isAdminRole,
  isTechnicianRole,
  roleDisplayLabel,
} from '@/lib/permissions';

type RoleGateProps = {
  role: string | null | undefined;
  children: React.ReactNode;
  fallback?: React.ReactNode;
};

/** Renders children only for ADMIN | TECHNICIAN | AGENT. */
export function OperatorOnly({ role, children, fallback = null }: RoleGateProps) {
  if (!canAccessOperatorArea({ role: role || '' })) return <>{fallback}</>;
  return <>{children}</>;
}

/** System settings / config UI — ADMIN only. */
export function AdminSettingsOnly({ role, children, fallback = null }: RoleGateProps) {
  if (!canManageSettings({ role: role || '' })) return <>{fallback}</>;
  return <>{children}</>;
}

/** Technician CRUD — ADMIN only. */
export function ManageTechniciansOnly({ role, children, fallback = null }: RoleGateProps) {
  if (!canManageTechnicians({ role: role || '' })) return <>{fallback}</>;
  return <>{children}</>;
}

/** Global Microsoft sync trigger — ADMIN only. */
export function SyncMicrosoftOnly({ role, children, fallback = null }: RoleGateProps) {
  if (!canSyncMicrosoft({ role: role || '' })) return <>{fallback}</>;
  return <>{children}</>;
}

export function RoleBadge({ role }: { role: string | null | undefined }) {
  const label = roleDisplayLabel(role);
  const isAdmin = isAdminRole(role);
  const isTech = isTechnicianRole(role);
  const className = isAdmin
    ? 'text-indigo-400 text-xs px-2 py-0.5 rounded bg-indigo-500/10 font-bold border border-indigo-500/20'
    : isTech
      ? 'text-emerald-400 text-xs px-2 py-0.5 rounded bg-emerald-500/10 font-bold border border-emerald-500/20'
      : 'text-slate-400 text-xs px-2 py-0.5 rounded bg-slate-500/10 font-bold border border-slate-500/20';

  return <span className={className}>{isAdmin ? 'ADMIN' : isTech ? 'TÉCNICO' : label}</span>;
}
