import {
  getTechnicianProfile,
  getVisibleAccountUpnsForUser,
  normalizeReceiveMode,
} from '@/lib/technician-routing';
import type { TechnicianAccessContext } from '@/lib/permissions';
import { isTechnicianRole } from '@/lib/permissions';

/**
 * Loads Foundation/Routing technician context for canAccessTicket / list filters.
 * Server-only (uses prisma via technician-routing).
 */
export async function loadTechnicianAccessContext(
  userId: string,
  role: string
): Promise<TechnicianAccessContext> {
  if (!isTechnicianRole(role)) {
    return {};
  }

  try {
    const profile = await getTechnicianProfile(userId);
    if (!profile) {
      return { receiveMode: 'SHARED_WITH_ADMIN', visibleAccounts: [] };
    }

    const visibleAccounts = await getVisibleAccountUpnsForUser({ id: userId, role });

    return {
      receiveMode: normalizeReceiveMode(profile.receiveMode),
      visibleAccounts,
      monitoredAccounts: [...profile.monitoredEmails, ...profile.monitoredTeamsAccounts],
    };
  } catch {
    return { receiveMode: 'SHARED_WITH_ADMIN' };
  }
}
