import dns from 'dns';
import 'dotenv/config';
import { Pool } from 'pg';

dns.setDefaultResultOrder('ipv4first');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  const col = await pool.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'ticket_support'
      AND table_name = 'Ticket'
      AND column_name = 'resolution'
  `);
  console.log('column:', JSON.stringify(col.rows[0] || null));

  const tickets = await pool.query(
    `SELECT id, title, resolution FROM "ticket_support"."Ticket" LIMIT 3`
  );
  console.log('ticket_select_ok rows=', tickets.rowCount);
  process.exitCode = col.rows.length ? 0 : 1;
} catch (e) {
  console.error('FAIL', e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
