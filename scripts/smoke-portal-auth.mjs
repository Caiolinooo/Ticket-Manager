/**
 * Smoke: Portal (EmployeeHub) auth integration for Ticket-Manager client.
 * - Reads public.users_unified
 * - Verifies bcrypt password when PORTAL_TEST_EMAIL + PORTAL_TEST_PASSWORD are set
 * - Signs/verifies TM session JWT
 * Never prints secrets or passwords.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

function mask(value) {
  if (!value) return '(empty)';
  return `${String(value).slice(0, 4)}… (len=${String(value).length})`;
}

async function main() {
  console.log('=== smoke-portal-auth ===');

  const jwtSecret = process.env.JWT_SECRET || process.env.TM_SESSION_SECRET;
  if (!jwtSecret) {
    console.error('FAIL: JWT_SECRET or TM_SESSION_SECRET missing');
    process.exitCode = 1;
    return;
  }
  console.log('JWT secret:', mask(jwtSecret));

  const cols = await pool.query(`
    SELECT COUNT(*)::int AS n
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users_unified'
  `);
  if (cols.rows[0].n < 5) {
    console.error('FAIL: users_unified not accessible');
    process.exitCode = 1;
    return;
  }
  console.log('OK: public.users_unified accessible');

  const users = await pool.query(`
    SELECT id, email, role, active, is_authorized,
           (password IS NOT NULL OR password_hash IS NOT NULL) AS has_password
    FROM public.users_unified
    WHERE email IS NOT NULL AND active = true
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 3
  `);
  console.log('OK: sample portal users', users.rows.map((u) => ({
    email: u.email,
    role: u.role,
    authorized: u.is_authorized,
    has_password: u.has_password,
  })));

  const sessionSecret = process.env.TM_SESSION_SECRET || process.env.JWT_SECRET;
  const token = jwt.sign(
    { id: 'smoke-id', name: 'Smoke', email: 'smoke@example.com', role: 'EMPLOYEE', authSource: 'portal' },
    sessionSecret,
    { expiresIn: 60 }
  );
  const decoded = jwt.verify(token, sessionSecret);
  if (decoded.email !== 'smoke@example.com') {
    console.error('FAIL: session JWT roundtrip');
    process.exitCode = 1;
    return;
  }
  console.log('OK: TM session JWT sign/verify');

  const portalToken = jwt.sign(
    { userId: users.rows[0]?.id || '00000000-0000-0000-0000-000000000000', phoneNumber: '', role: 'USER' },
    process.env.JWT_SECRET || sessionSecret,
    { expiresIn: '1h' }
  );
  const portalPayload = jwt.verify(portalToken, process.env.JWT_SECRET || sessionSecret);
  if (!portalPayload.userId) {
    console.error('FAIL: portal JWT shape');
    process.exitCode = 1;
    return;
  }
  console.log('OK: portal-shaped JWT verify');

  const testEmail = process.env.PORTAL_TEST_EMAIL?.trim();
  const testPassword = process.env.PORTAL_TEST_PASSWORD;
  if (testEmail && testPassword) {
    const row = await pool.query(
      `SELECT password, password_hash, active, is_authorized, authorization_status
       FROM public.users_unified WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [testEmail]
    );
    if (row.rows.length === 0) {
      console.error('FAIL: PORTAL_TEST_EMAIL not found');
      process.exitCode = 1;
      return;
    }
    const u = row.rows[0];
    const hash = u.password || u.password_hash;
    const ok = hash ? await bcrypt.compare(testPassword, hash) : false;
    console.log(ok ? 'OK: portal password validates for test user' : 'FAIL: portal password mismatch');
    if (!ok) process.exitCode = 1;
  } else {
    console.log('SKIP: live password check (set PORTAL_TEST_EMAIL + PORTAL_TEST_PASSWORD)');
  }

  console.log('=== smoke-portal-auth done ===');
}

main()
  .catch((e) => {
    console.error('ERR', e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
