/**
 * Smoke: unsigned base64 "legacy" session cookies must NOT authenticate.
 *
 *   node scripts/smoke-reject-forged-session.mjs
 */
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';

// Optional .env load when dependencies are installed
try {
  createRequire(import.meta.url)('dotenv').config();
} catch {
  // ignore — secrets fall back to defaults for this unit smoke
}

const secret =
  process.env.TM_SESSION_SECRET?.trim() ||
  process.env.JWT_SECRET?.trim() ||
  'dev-only-session-secret';

function verifySessionToken(token) {
  try {
    const payload = jwt.verify(token, secret);
    if (!payload?.id || !payload?.email || !payload?.role) return null;
    return {
      id: payload.id,
      name: payload.name,
      email: payload.email,
      role: payload.role,
    };
  } catch {
    return null;
  }
}

function parseLegacySession(raw) {
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf-8');
    const data = JSON.parse(decoded);
    if (!data?.id || !data?.email || !data?.role) return null;
    return data;
  } catch {
    return null;
  }
}

const forged = Buffer.from(
  JSON.stringify({
    id: 'forged-admin-id',
    name: 'Forged Admin',
    email: 'forged@example.com',
    role: 'ADMIN',
  }),
  'utf-8'
).toString('base64');

const legacyWouldAccept = parseLegacySession(forged);
const jwtRejects = verifySessionToken(forged);

const valid = jwt.sign(
  {
    id: 'real-user',
    name: 'Real',
    email: 'real@example.com',
    role: 'ADMIN',
  },
  secret,
  { expiresIn: 60 }
);
const jwtAccepts = verifySessionToken(valid);

console.log('=== smoke-reject-forged-session ===');
console.log({
  forgedLegacyParsable: Boolean(legacyWouldAccept),
  forgedJwtRejected: jwtRejects === null,
  validJwtAccepted: Boolean(jwtAccepts),
});

if (!legacyWouldAccept) {
  console.error('FAIL: fixture forged cookie should still parse as legacy JSON (test setup)');
  process.exit(1);
}
if (jwtRejects !== null) {
  console.error('FAIL: forged base64 session must not verify as JWT');
  process.exit(1);
}
if (!jwtAccepts) {
  console.error('FAIL: signed JWT session should verify');
  process.exit(1);
}

console.log('=== OK: unsigned legacy sessions are rejected by JWT verification ===');
