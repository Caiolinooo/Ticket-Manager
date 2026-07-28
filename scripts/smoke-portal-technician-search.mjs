/**
 * Smoke: portal-users search API (requires ADMIN session).
 *
 * Uses ADMIN_EMAIL + ADMIN_PASSWORD (or TM_SMOKE_ADMIN_*) — never prints password.
 *
 *   node scripts/smoke-portal-technician-search.mjs
 */
import 'dotenv/config';

const base = process.env.SMOKE_BASE || 'http://127.0.0.1:9120';
const adminEmail = process.env.ADMIN_EMAIL || process.env.TM_SMOKE_ADMIN_EMAIL || '';
const adminPassword = process.env.ADMIN_PASSWORD || process.env.TM_SMOKE_ADMIN_PASSWORD || '';

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
  console.log('=== smoke-portal-technician-search ===');
  console.log('base:', base);

  if (!adminEmail || !adminPassword) {
    console.log('SKIP: set ADMIN_EMAIL + ADMIN_PASSWORD to exercise search API');
    return;
  }

  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword, area: 'admin' }),
  });
  const loginBody = await loginRes.json();
  console.log('admin_login', { http: loginRes.status, success: loginBody.success, role: loginBody.user?.role });
  if (!loginRes.ok || !loginBody.success) {
    console.error('FAIL: admin login');
    process.exitCode = 1;
    return;
  }

  const cookie = cookieFrom(loginRes);
  if (!cookie) {
    console.error('FAIL: no session cookie');
    process.exitCode = 1;
    return;
  }

  const shortRes = await fetch(`${base}/api/settings/technicians/portal-users?q=a`, {
    headers: { Cookie: cookie },
  });
  const shortBody = await shortRes.json();
  console.log('search_short_q', { http: shortRes.status, users: shortBody.users?.length });

  const q = process.env.PORTAL_SEARCH_Q || adminEmail.slice(0, 4);
  const searchRes = await fetch(
    `${base}/api/settings/technicians/portal-users?q=${encodeURIComponent(q)}`,
    { headers: { Cookie: cookie } }
  );
  const searchBody = await searchRes.json();
  console.log('search', {
    http: searchRes.status,
    success: searchBody.success,
    count: Array.isArray(searchBody.users) ? searchBody.users.length : null,
    sample: (searchBody.users || []).slice(0, 3).map((u) => ({
      email: u.email,
      name: u.name,
      hasPassword: 'password' in u || 'passwordHash' in u || 'password_hash' in u,
    })),
  });

  if (!searchRes.ok || !searchBody.success) {
    console.error('FAIL: portal-users search');
    process.exitCode = 1;
    return;
  }

  const leaked = (searchBody.users || []).some(
    (u) => 'password' in u || 'passwordHash' in u || 'password_hash' in u
  );
  if (leaked) {
    console.error('FAIL: password fields must not be returned');
    process.exitCode = 1;
    return;
  }

  console.log('OK: portal-users search');
}

main().catch((err) => {
  console.error('FAIL:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
