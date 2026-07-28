/**
 * Smoke: TECHNICIAN linked to Portal + operator login via Portal bcrypt.
 *
 * Creates a temporary users_unified row + SupportUser TECHNICIAN, logs in with
 * area=admin using the Portal password, checks permissions, then cleans up.
 * Never prints the password.
 *
 *   node scripts/smoke-technician-auth.mjs
 *   SMOKE_BASE=http://127.0.0.1:9120 node scripts/smoke-technician-auth.mjs
 */
import 'dotenv/config';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';

const base = process.env.SMOKE_BASE || 'http://127.0.0.1:9120';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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
  console.log('=== smoke-technician-auth (portal) ===');
  console.log('base:', base);

  const suffix = crypto.randomBytes(4).toString('hex');
  const email = `tech.portal.smoke.${suffix}@example.com`;
  const password = `SmokePortal_${crypto.randomBytes(6).toString('hex')}`;
  const passwordHash = await bcrypt.hash(password, 10);
  let portalUserId = null;
  let supportUserId = null;

  try {
    await pool.query(`
      ALTER TABLE "ticket_support"."SupportUser"
        ADD COLUMN IF NOT EXISTS "monitoredEmails" TEXT,
        ADD COLUMN IF NOT EXISTS "monitoredTeamsAccounts" TEXT,
        ADD COLUMN IF NOT EXISTS "receiveMode" TEXT,
        ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "portalUserId" TEXT,
        ADD COLUMN IF NOT EXISTS "authSource" TEXT
    `);

    const portalInsert = await pool.query(
      `INSERT INTO public.users_unified
        (id, email, first_name, last_name, role, active, is_authorized, authorization_status, password_hash)
       VALUES ($1, $2, $3, $4, 'USER', true, true, 'active', $5)
       RETURNING id, email`,
      [crypto.randomUUID(), email, 'Smoke', 'Technician', passwordHash]
    );
    portalUserId = portalInsert.rows[0].id;
    console.log('created_portal_user', { id: portalUserId, email });

    const supportInsert = await pool.query(
      `INSERT INTO ticket_support."SupportUser"
        (id, email, "passwordHash", name, role, "receiveMode", active, "portalUserId", "authSource", "createdAt")
       VALUES ($1, $2, 'portal-auth', $3, 'TECHNICIAN', 'SHARED_WITH_ADMIN', true, $4, 'portal', NOW())
       RETURNING id, email, role`,
      [crypto.randomUUID(), email, 'Smoke Technician', portalUserId]
    );
    supportUserId = supportInsert.rows[0].id;
    console.log('created_technician', { id: supportUserId, email, role: 'TECHNICIAN' });

    // Search API requires ADMIN session — skip if no ADMIN_TEST_*; verify DB search path instead
    const searchRows = await pool.query(
      `SELECT id, email FROM public.users_unified
       WHERE email ILIKE $1 OR first_name ILIKE $1
       LIMIT 5`,
      [`%tech.portal.smoke.${suffix}%`]
    );
    console.log('portal_search_db', { hits: searchRows.rows.length, match: searchRows.rows[0]?.email === email });
    if (searchRows.rows.length < 1) {
      console.error('FAIL: portal user not searchable');
      process.exitCode = 1;
      return;
    }

    const loginRes = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, area: 'admin' }),
    });
    const loginBody = await loginRes.json();
    console.log('technician_portal_login', {
      http: loginRes.status,
      success: loginBody.success,
      role: loginBody.user?.role,
      authSource: loginBody.user?.authSource,
    });
    if (!loginRes.ok || !loginBody.success || loginBody.user?.role !== 'TECHNICIAN') {
      console.error('FAIL: technician operator login via Portal');
      process.exitCode = 1;
      return;
    }
    if (loginBody.user?.authSource !== 'portal') {
      console.error('FAIL: expected authSource=portal');
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

    const techCrudRes = await fetch(`${base}/api/settings/technicians`, {
      headers: { Cookie: cookie },
    });
    console.log('technicians_crud_denied', { http: techCrudRes.status });
    if (techCrudRes.status !== 403) {
      console.error('FAIL: technician must not CRUD technicians');
      process.exitCode = 1;
      return;
    }

    // Wrong password must fail
    const badRes = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'wrong-password-xyz', area: 'admin' }),
    });
    console.log('wrong_password_denied', { http: badRes.status });
    if (badRes.status === 200) {
      console.error('FAIL: wrong portal password should not login');
      process.exitCode = 1;
      return;
    }

    console.log('OK: technician Portal login + permissions');
  } catch (err) {
    console.error('FAIL:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    if (supportUserId) {
      try {
        await pool.query(`DELETE FROM ticket_support."AuditLog" WHERE "userId"=$1`, [supportUserId]);
        await pool.query(`DELETE FROM ticket_support."SupportUser" WHERE id=$1`, [supportUserId]);
        console.log('cleaned_technician', supportUserId);
      } catch (cleanupErr) {
        console.error('cleanup support warning:', cleanupErr instanceof Error ? cleanupErr.message : cleanupErr);
      }
    }
    if (portalUserId) {
      try {
        await pool.query(`DELETE FROM public.users_unified WHERE id=$1`, [portalUserId]);
        console.log('cleaned_portal_user', portalUserId);
      } catch (cleanupErr) {
        console.error('cleanup portal warning:', cleanupErr instanceof Error ? cleanupErr.message : cleanupErr);
      }
    }
    await pool.end();
  }
}

main();
