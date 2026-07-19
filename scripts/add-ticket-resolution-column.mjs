import dns from 'dns';
import 'dotenv/config';
import { Pool } from 'pg';

dns.setDefaultResultOrder('ipv4first');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 20000,
});

const alterSql = `
ALTER TABLE "ticket_support"."Ticket"
ADD COLUMN IF NOT EXISTS "resolution" TEXT;
`;

const checkSql = `
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'ticket_support' AND table_name = 'Ticket'
ORDER BY ordinal_position;
`;

const client = await pool.connect();
try {
  await client.query(alterSql);
  console.log('ALTER applied (ADD COLUMN IF NOT EXISTS resolution)');
  const { rows } = await client.query(checkSql);
  console.log(JSON.stringify(rows, null, 2));
  const resolution = rows.find((r) => r.column_name === 'resolution');
  if (!resolution) {
    console.error('FAILED: resolution column still missing');
    process.exitCode = 1;
  } else {
    console.log('OK:', JSON.stringify(resolution));
  }
} finally {
  client.release();
  await pool.end();
}
