/**
 * Smoke: TECHNICIAN operator login + permission matrix (ADMIN vs TECHNICIAN).
 *
 * Creates a temporary TECHNICIAN user, logs in via area=admin, checks /me + tickets,
 * asserts settings/sync are denied, then cleans up.
 *
 *   node scripts/smoke-technician-auth.mjs
 *   SMOKE_BASE=http://127.0.0.1:9120 node scripts/smoke-technician-auth.mjs
 */
import 'dotenv/config';
import crypto from 'crypto';
import { Pool } from 'pg';

const base = process.env.SMOKE_BASE || 'http://127.0.0.1:9120';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function cookieFrom(res) {
  const setCookies =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie')].filter(Boolean);
  const session = setCookies.find((c) => /session=/i.test(c));
  if (!session) return null;
  return session.split(';')[0];
}

async function main() {
  console.log('=== smoke-technician-auth ===');
  console.log('base:', base);

  const email = `tech.smoke.${crypto.randomBytes(4).toString('hex')}@example.com`;
  const password = `SmokeTech_${crypto.randomBytes(6).toString('hex')}`;
  const passwordHash = hashPassword(password);
  let userId = null;

  try {
    // Ensure Foundation columns exist (no-op if already applied)
    await pool.query(`
      ALTER TABLE "ticket_support"."SupportUser"
        ADD COLUMN IF NOT EXISTS "monitoredEmails" TEXT,
        ADD COLUMN IF NOT EXISTS "monitoredTeamsAccounts" TEXT,
        ADD COLUMN IF NOT EXISTS "receiveMode" TEXT,
        ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true
    `);

    const inserted = await pool.query(
      `INSERT INTO ticket_support."SupportUser"
        (id, email, "passwordHash", name, role, "receiveMode", active, "createdAt")
       VALUES ($1, $2, $3, $4, 'TECHNICIAN', 'SHARED_WITH_ADMIN', true, NOW())
       RETURNING id, email, role`,
      [crypto.randomUUID(), email, passwordHash, 'Smoke Technician']
    );
    userId = inserted.rows[0].id;
    console.log('created_technician', { id: userId, email, role: 'TECHNICIAN' });

    const loginRes = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, area: 'admin' }),
    });
    const loginBody = await loginRes.json();
    console.log('technician_login', {
      http: loginRes.status,
      success: loginBody.success,
      role: loginBody.user?.role,
    });
    if (!loginRes.ok || !loginBody.success || loginBody.user?.role !== 'TECHNICIAN') {
      console.error('FAIL: technician operator login');
      process.exitCode = 1;
      return;
    }

    const cookie = cookieFrom(loginRes);
    if (!cookie) {
      console.error('FAIL: no session cookie');
      process.exitCode = 1;
      return;
    }

    const meRes = await fetch(`${base}/api/auth/me`, {
      headers: { Cookie: cookie },
    });
    const meBody = await meRes.json();
    console.log('me', { http: meRes.status, role: meBody.user?.role });
    if (!meRes.ok || meBody.user?.role !== 'TECHNICIAN') {
      console.error('FAIL: /me');
      process.exitCode = 1;
      return;
    }

    const ticketsRes = await fetch(`${base}/api/tickets`, {
      headers: { Cookie: cookie },
    });
    const ticketsBody = await ticketsRes.json();
    console.log('tickets', {
      http: ticketsRes.status,
      success: ticketsBody.success,
      count: Array.isArray(ticketsBody.tickets) ? ticketsBody.tickets.length : null,
    });
    if (!ticketsRes.ok || !ticketsBody.success) {
      console.error('FAIL: tickets list');
      process.exitCode = 1;
      return;
    }

    const settingsRes = await fetch(`${base}/api/settings`, {
      headers: { Cookie: cookie },
    });
    console.log('settings_denied', { http: settingsRes.status });
    if (settingsRes.status !== 403) {
      console.error('FAIL: technician must not read settings');
      process.exitCode = 1;
      return;
    }

    const syncRes = await fetch(`${base}/api/integrations/teams`, {
      headers: { Cookie: cookie },
    });
    console.log('sync_denied', { http: syncRes.status });
    if (syncRes.status !== 403) {
      console.error('FAIL: technician must not trigger Microsoft sync');
      process.exitCode = 1;
      return;
    }

    const pendingRes = await fetch(`${base}/api/integrations/pending`, {
      headers: { Cookie: cookie },
    });
    const pendingBody = await pendingRes.json();
    console.log('pending_ok', { http: pendingRes.status, success: pendingBody.success });
    if (!pendingRes.ok || !pendingBody.success) {
      console.error('FAIL: technician should read pending queue');
      process.exitCode = 1;
      return;
    }

    const techCrudRes = await fetch(`${base}/api/settings/technicians`, {
      headers: { Cookie: cookie },
    });
    console.log('technicians_crud_denied', { http: techCrudRes.status });
    if (techCrudRes.status !== 403) {
      console.error('FAIL: technician must not CRUD technicians');
      process.exitCode = 1;
      return;
    }

    console.log('matrix', {
      operatorLogin: true,
      viewTickets: true,
      pending: true,
      settings: false,
      microsoftSync: false,
      crudTechnicians: false,
    });
    console.log('OK: technician operator login + permissions');
  } catch (err) {
    console.error('FAIL:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    if (userId) {
      try {
        await pool.query(`DELETE FROM ticket_support."AuditLog" WHERE "userId"=$1`, [userId]);
        await pool.query(`DELETE FROM ticket_support."SupportUser" WHERE id=$1`, [userId]);
        console.log('cleaned_technician', userId);
      } catch (cleanupErr) {
        console.error('cleanup warning:', cleanupErr instanceof Error ? cleanupErr.message : cleanupErr);
      }
    }
    await pool.end();
  }
}

main();
