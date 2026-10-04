// Freezes the customer's name onto each bill so renaming a customer no longer
// rewrites old orders / advance receipts. Reads use COALESCE(snapshot, c.name).
import { neon } from '@neondatabase/serverless';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf-8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=')[1].trim();

const sql = neon(dbUrl);

async function main() {
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name_snapshot TEXT`;
  await sql`ALTER TABLE advance_orders ADD COLUMN IF NOT EXISTS customer_name_snapshot TEXT`;

  // Backfill existing rows with the customer's CURRENT name (the best we have).
  const o = await sql`
    UPDATE orders o
    SET customer_name_snapshot = c.name
    FROM customers c
    WHERE c.id = o.customer_id AND o.customer_name_snapshot IS NULL
    RETURNING o.id
  `;
  const a = await sql`
    UPDATE advance_orders a
    SET customer_name_snapshot = c.name
    FROM customers c
    WHERE c.id = a.customer_id AND a.customer_name_snapshot IS NULL
    RETURNING a.id
  `;
  console.log(`customer_name_snapshot added. Backfilled ${o.length} order(s), ${a.length} advance order(s).`);
}

main().catch(console.error);
