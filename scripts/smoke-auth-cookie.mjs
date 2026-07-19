/**
 * Smoke: login must set a browser-usable session cookie on HTTP.
 * Uses a temporary ADMIN password (restored afterwards). Never prints secrets.
 *
 *   node scripts/smoke-auth-cookie.mjs
 *   SMOKE_BASE=http://127.0.0.1:9120 node scripts/smoke-auth-cookie.mjs
 */
import 'dotenv/config';
import crypto from 'crypto';
import { Pool } from 'pg';

const base = process.env.SMOKE_BASE || 'http://127.0.0.1:9120';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

async function main() {
  console.log('=== smoke-auth-cookie ===');
  console.log('base:', base);

  const r = await pool.query(`
    SELECT id, email, role, "passwordHash"
    FROM ticket_support."SupportUser"
    WHERE role IN ('ADMIN', 'AGENT')
    ORDER BY "createdAt" ASC NULLS LAST
    LIMIT 1
  `);
  if (!r.rows.length) {
    console.error('FAIL: no ADMIN/AGENT user');
    process.exitCode = 1;
    return;
  }

  const user = r.rows[0];
  const oldHash = user.passwordHash;
  const smokePass = `SmokeCookie_${crypto.randomBytes(6).toString('hex')}`;
  const smokeHash = hashPassword(smokePass);

  try {
    await pool.query(
      `UPDATE ticket_support."SupportUser" SET "passwordHash"=$1 WHERE id=$2`,
      [smokeHash, user.id]
    );

    const loginRes = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email: user.email, password: smokePass, area: 'admin' }),
    });
    const loginBody = await loginRes.json();
    console.log('admin_login', {
      http: loginRes.status,
      success: loginBody.success,
      role: loginBody.user?.role,
    });
    if (!loginRes.ok || !loginBody.success) {
      console.error('FAIL: admin login');
      process.exitCode = 1;
      return;
    }

    const setCookies =
      typeof loginRes.headers.getSetCookie === 'function'
        ? loginRes.headers.getSetCookie()
        : [loginRes.headers.get('set-cookie')].filter(Boolean);
    const joined = setCookies.join(' | ');
    const hasSecure = /;\s*Secure/i.test(joined);
    const baseIsHttp = base.startsWith('http://');

    console.log('set_cookie_flags', {
      count: setCookies.length,
      hasSession: /session=/i.test(joined),
      secure: hasSecure,
      httpOnly: /;\s*HttpOnly/i.test(joined),
      sameSite: (joined.match(/;\s*SameSite=([^;]+)/i) || [])[1] || null,
    });

    if (!/session=/i.test(joined)) {
      console.error('FAIL: missing session Set-Cookie');
      process.exitCode = 1;
      return;
    }
    if (baseIsHttp && hasSecure) {
      console.error('FAIL: Secure cookie on HTTP — browsers will ignore it');
      process.exitCode = 1;
      return;
    }

    const cookiePair = joined
      .split(/,(?=\s*[^;=]+=)| \| /)
      .map((c) => c.trim().split(';')[0])
      .find((c) => c.toLowerCase().startsWith('session='));

    const meRes = await fetch(`${base}/api/auth/me`, {
      headers: cookiePair ? { Cookie: cookiePair } : {},
      credentials: 'include',
    });
    const meBody = await meRes.json();
    console.log('me', { http: meRes.status, role: meBody.user?.role });
    if (!meRes.ok || meBody.user?.role !== loginBody.user?.role) {
      console.error('FAIL: /api/auth/me after login');
      process.exitCode = 1;
      return;
    }

    const ssoRes = await fetch(`${base}/api/auth/sso`, {
      method: 'POST',
      credentials: 'include',
    });
    const ssoBody = await ssoRes.json();
    console.log('sso_no_portal_cookie', {
      http: ssoRes.status,
      skipped: ssoBody.skipped === true,
      success: ssoBody.success,
    });
    if (ssoRes.status === 401 && ssoBody.skipped !== true) {
      // After fix: no portal token should not be 401 spam
      console.error('FAIL: SSO without portal cookie returned 401');
      process.exitCode = 1;
      return;
    }

    console.log('=== OK ===');
  } finally {
    await pool.query(
      `UPDATE ticket_support."SupportUser" SET "passwordHash"=$1 WHERE id=$2`,
      [oldHash, user.id]
    );
    await pool.end();
  }
}

main().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
