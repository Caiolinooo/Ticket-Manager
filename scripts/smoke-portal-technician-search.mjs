/**
 * Smoke portal-users search without relying on production ADMIN password.
 * Creates temporary ADMIN, searches, asserts no password leak, cleans up.
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
  console.log('=== smoke-portal-technician-search (temp admin) ===');
  const suffix = crypto.randomBytes(4).toString('hex');
  const email = `admin.smoke.search.${suffix}@example.com`;
  const password = `SmokeAdmin_${crypto.randomBytes(6).toString('hex')}`;
  let adminId = null;

  try {
    const inserted = await pool.query(
      `INSERT INTO ticket_support."SupportUser"
        (id, email, "passwordHash", name, role, active, "createdAt")
       VALUES ($1, $2, $3, $4, 'ADMIN', true, NOW())
       RETURNING id, email`,
      [crypto.randomUUID(), email, hashPassword(password), 'Smoke Admin Search']
    );
    adminId = inserted.rows[0].id;
    console.log('created_temp_admin', { id: adminId, email });

    const loginRes = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, area: 'admin' }),
    });
    const loginBody = await loginRes.json();
    console.log('admin_login', { http: loginRes.status, success: loginBody.success, role: loginBody.user?.role });
    if (!loginRes.ok || !loginBody.success) {
      console.error('FAIL: temp admin login');
      process.exitCode = 1;
      return;
    }

    const cookie = cookieFrom(loginRes);
    const searchRes = await fetch(`${base}/api/settings/technicians/portal-users?q=co`, {
      headers: { Cookie: cookie },
    });
    const searchBody = await searchRes.json();
    console.log('search', {
      http: searchRes.status,
      success: searchBody.success,
      count: Array.isArray(searchBody.users) ? searchBody.users.length : null,
      sample: (searchBody.users || []).slice(0, 2).map((u) => ({ email: u.email, name: u.name })),
    });

    if (!searchRes.ok || !searchBody.success) {
      console.error('FAIL: portal-users search');
      process.exitCode = 1;
      return;
    }

    if (!Array.isArray(searchBody.users) || searchBody.users.length < 1) {
      console.error('FAIL: expected at least one Portal user for q=co');
      process.exitCode = 1;
      return;
    }

    const leaked = (searchBody.users || []).some(
      (u) => 'password' in u || 'passwordHash' in u || 'password_hash' in u
    );
    if (leaked) {
      console.error('FAIL: password fields leaked');
      process.exitCode = 1;
      return;
    }

    // Non-admin must be denied
    const denied = await fetch(`${base}/api/settings/technicians/portal-users?q=test`);
    console.log('unauth_denied', { http: denied.status });
    if (denied.status !== 403 && denied.status !== 401) {
      console.error('FAIL: unauthenticated search should be denied');
      process.exitCode = 1;
      return;
    }

    console.log('OK: portal-users search API');
  } catch (err) {
    console.error('FAIL:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    if (adminId) {
      try {
        await pool.query(`DELETE FROM ticket_support."AuditLog" WHERE "userId"=$1`, [adminId]);
        await pool.query(`DELETE FROM ticket_support."SupportUser" WHERE id=$1`, [adminId]);
        console.log('cleaned_temp_admin', adminId);
      } catch (e) {
        console.error('cleanup warning:', e instanceof Error ? e.message : e);
      }
    }
    await pool.end();
  }
}

main();
