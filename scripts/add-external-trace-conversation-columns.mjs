/**
 * Applies conversationId/memberIds columns on ExternalTrace if missing.
 * Safe to re-run (IF NOT EXISTS).
 */
import dns from 'dns';
import 'dotenv/config';
import { Pool } from 'pg';

dns.setDefaultResultOrder('ipv4first');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 20000,
});

const client = await pool.connect();
try {
  await client.query(`
    ALTER TABLE "ticket_support"."ExternalTrace"
      ADD COLUMN IF NOT EXISTS "conversationId" TEXT
  `);
  await client.query(`
    ALTER TABLE "ticket_support"."ExternalTrace"
      ADD COLUMN IF NOT EXISTS "memberIds" TEXT
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS "ExternalTrace_platform_conversationId_status_idx"
      ON "ticket_support"."ExternalTrace" ("platform", "conversationId", "status")
  `);

  const { rows } = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'ticket_support'
      AND table_name = 'ExternalTrace'
      AND column_name IN ('conversationId', 'memberIds')
    ORDER BY column_name
  `);

  console.log('ExternalTrace grouping columns:', JSON.stringify(rows, null, 2));
  if (rows.length < 2) {
    console.error('FAILED: expected conversationId and memberIds');
    process.exitCode = 1;
  } else {
    console.log('OK: grouping columns present');
  }
} finally {
  client.release();
  await pool.end();
}
