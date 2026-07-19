/**
 * Run on the Ticket-Manager server:
 *   PORTAL_TEST_EMAIL=... PORTAL_TEST_PASSWORD=... node scripts/remote-smoke-portal-login.mjs
 * Does not print passwords.
 */
import 'dotenv/config';

const base = process.env.SMOKE_BASE || 'http://127.0.0.1:9120';
const email = process.env.PORTAL_TEST_EMAIL?.trim();
const password = process.env.PORTAL_TEST_PASSWORD;
  // Prefer an explicit admin test account; otherwise try the same email as operator.
  const adminEmail = process.env.ADMIN_TEST_EMAIL || email;
  const adminPassword = process.env.ADMIN_TEST_PASSWORD || password;

function parseSetCookie(res) {
  const raw = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [];
  if (raw.length) return raw.map((c) => c.split(';')[0]).join('; ');
  const single = res.headers.get('set-cookie');
  return single ? single.split(',').map((c) => c.split(';')[0].trim()).join('; ') : '';
}

async function main() {
  if (!email || !password) {
    console.error('FAIL: set PORTAL_TEST_EMAIL and PORTAL_TEST_PASSWORD');
    process.exit(1);
  }

  console.log('=== remote-smoke-portal-login ===');
  console.log('base:', base);
  console.log('portal email:', email);

  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, area: 'client' }),
  });
  const loginBody = await loginRes.json();
  console.log('portal_login', {
    http: loginRes.status,
    success: loginBody.success,
    role: loginBody.user?.role,
    authSource: loginBody.user?.authSource,
    email: loginBody.user?.email,
  });
  if (!loginRes.ok || !loginBody.success || loginBody.user?.role !== 'EMPLOYEE') {
    console.error('FAIL: portal client login');
    process.exit(1);
  }
  if (loginBody.user?.authSource !== 'portal') {
    console.error('FAIL: expected authSource=portal');
    process.exit(1);
  }

  const setCookieRaw = typeof loginRes.headers.getSetCookie === 'function'
    ? loginRes.headers.getSetCookie()
    : [loginRes.headers.get('set-cookie')].filter(Boolean);
  const setCookieJoined = setCookieRaw.join(' | ');
  const baseIsHttp = base.startsWith('http://');
  const hasSecure = /;\s*Secure/i.test(setCookieJoined);
  console.log('session_cookie_flags', {
    hasSession: /session=/i.test(setCookieJoined),
    secure: hasSecure,
    httpOnly: /;\s*HttpOnly/i.test(setCookieJoined),
    sameSite: (setCookieJoined.match(/;\s*SameSite=([^;]+)/i) || [])[1] || null,
  });
  if (baseIsHttp && hasSecure) {
    console.error('FAIL: Set-Cookie has Secure on HTTP base — browser will drop the cookie');
    process.exit(1);
  }

  const cookie = parseSetCookie(loginRes);
  if (!cookie.includes('session=')) {
    console.error('FAIL: session cookie missing');
    process.exit(1);
  }

  const meRes = await fetch(`${base}/api/auth/me`, {
    headers: { Cookie: cookie },
    credentials: 'include',
  });
  const meBody = await meRes.json();
  console.log('me', { http: meRes.status, role: meBody.user?.role, authSource: meBody.user?.authSource });
  if (!meRes.ok) {
    console.error('FAIL: /api/auth/me');
    process.exit(1);
  }

  await fetch(`${base}/api/auth/logout`, {
    method: 'POST',
    headers: { Cookie: cookie },
  });

  const adminRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword, area: 'admin' }),
  });
  const adminBody = await adminRes.json();
  console.log('admin_login', {
    http: adminRes.status,
    success: adminBody.success,
    role: adminBody.user?.role,
    authSource: adminBody.user?.authSource,
  });
  if (!adminRes.ok || adminBody.user?.role !== 'ADMIN') {
    console.error('FAIL: admin local login broken');
    process.exit(1);
  }

  console.log('=== OK ===');
}

main().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
