import dns from 'dns';
import 'dotenv/config';
import { Pool } from 'pg';

dns.setDefaultResultOrder('ipv4first');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 20000,
});

const alterSql = `
ALTER TABLE "ticket_support"."SupportUser"
  ADD COLUMN IF NOT EXISTS "monitoredEmails" TEXT,
  ADD COLUMN IF NOT EXISTS "monitoredTeamsAccounts" TEXT,
  ADD COLUMN IF NOT EXISTS "receiveMode" TEXT,
  ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;
`;

const checkSql = `
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'ticket_support'
  AND table_name = 'SupportUser'
  AND column_name IN ('monitoredEmails', 'monitoredTeamsAccounts', 'receiveMode', 'active')
ORDER BY column_name;
`;

const client = await pool.connect();
try {
  await client.query(alterSql);
  console.log('ALTER applied (SupportUser technician fields)');
  const { rows } = await client.query(checkSql);
  console.log(JSON.stringify(rows, null, 2));

  const expected = ['active', 'monitoredEmails', 'monitoredTeamsAccounts', 'receiveMode'];
  const found = new Set(rows.map((r) => r.column_name));
  const missing = expected.filter((c) => !found.has(c));
  if (missing.length) {
    console.error('FAILED: missing columns:', missing.join(', '));
    process.exitCode = 1;
  } else {
    console.log('OK: technician fields present on ticket_support.SupportUser');
  }
} finally {
  client.release();
  await pool.end();
}
