// Adds discount / GST / delivery columns to advance_orders so an advance order
// remembers the full bill breakdown (previously only subtotal + total were saved,
// which lost the discount when the balance was collected).
import { neon } from '@neondatabase/serverless';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf-8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=')[1].trim();

const sql = neon(dbUrl);

async function main() {
  await sql`ALTER TABLE advance_orders ADD COLUMN IF NOT EXISTS discount_type   TEXT NOT NULL DEFAULT 'FIXED'`;
  await sql`ALTER TABLE advance_orders ADD COLUMN IF NOT EXISTS discount_value  NUMERIC(10, 2) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE advance_orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10, 2) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE advance_orders ADD COLUMN IF NOT EXISTS is_gst          BOOLEAN NOT NULL DEFAULT false`;
  await sql`ALTER TABLE advance_orders ADD COLUMN IF NOT EXISTS gst_percentage  NUMERIC(5, 2) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE advance_orders ADD COLUMN IF NOT EXISTS gst_amount      NUMERIC(10, 2) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE advance_orders ADD COLUMN IF NOT EXISTS delivery_fee    NUMERIC(10, 2) NOT NULL DEFAULT 0`;

  // Backfill existing rows from the old rule (total = subtotal - discount + delivery):
  // total below subtotal => the gap was a discount; above => it was delivery.
  const d = await sql`
    UPDATE advance_orders
    SET discount_amount = subtotal - total_amount
    WHERE discount_amount = 0 AND delivery_fee = 0 AND gst_amount = 0
      AND subtotal > total_amount
    RETURNING id
  `;
  const f = await sql`
    UPDATE advance_orders
    SET delivery_fee = total_amount - subtotal
    WHERE discount_amount = 0 AND delivery_fee = 0 AND gst_amount = 0
      AND total_amount > subtotal
    RETURNING id
  `;
  console.log(`advance_orders columns added. Backfilled ${d.length} discount row(s), ${f.length} delivery row(s).`);
}

main().catch(console.error);
