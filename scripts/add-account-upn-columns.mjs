import dns from 'dns';
import 'dotenv/config';
import { Pool } from 'pg';

dns.setDefaultResultOrder('ipv4first');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 20000,
});

const alterSql = `
ALTER TABLE "ticket_support"."ExternalTrace"
  ADD COLUMN IF NOT EXISTS "accountUpn" TEXT;

ALTER TABLE "ticket_support"."Ticket"
  ADD COLUMN IF NOT EXISTS "accountUpn" TEXT;

CREATE INDEX IF NOT EXISTS "ExternalTrace_accountUpn_status_idx"
  ON "ticket_support"."ExternalTrace" ("accountUpn", "status");

CREATE INDEX IF NOT EXISTS "Ticket_accountUpn_idx"
  ON "ticket_support"."Ticket" ("accountUpn");
`;

const checkSql = `
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'ticket_support'
  AND column_name = 'accountUpn'
  AND table_name IN ('ExternalTrace', 'Ticket')
ORDER BY table_name;
`;

const client = await pool.connect();
try {
  await client.query(alterSql);
  console.log('ALTER applied (accountUpn on ExternalTrace + Ticket)');
  const { rows } = await client.query(checkSql);
  console.log(JSON.stringify(rows, null, 2));

  const tables = new Set(rows.map((r) => r.table_name));
  const missing = ['ExternalTrace', 'Ticket'].filter((t) => !tables.has(t));
  if (missing.length) {
    console.error('FAILED: missing accountUpn on:', missing.join(', '));
    process.exitCode = 1;
  } else {
    console.log('OK: accountUpn present on ExternalTrace and Ticket');
  }
} finally {
  client.release();
  await pool.end();
}
