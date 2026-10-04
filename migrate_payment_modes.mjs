// The DB check constraints only allowed the old finance modes (CASH/TVS/BAJAJ/HDP/DMI),
// but the app bills with CASH / GPAY / SPLIT, so any GPAY or SPLIT sale or advance
// deposit was rejected. Widen both constraints; legacy values stay valid so
// existing rows (e.g. HDP) are untouched.
import { neon } from '@neondatabase/serverless';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf-8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=')[1].trim();

const sql = neon(dbUrl);

async function main() {
  await sql.transaction([
    sql`ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_mode_check`,
    sql`ALTER TABLE orders ADD CONSTRAINT orders_payment_mode_check
        CHECK (payment_mode IN ('CASH', 'GPAY', 'SPLIT', 'TVS', 'BAJAJ', 'HDP', 'DMI'))`,
    sql`ALTER TABLE advance_orders DROP CONSTRAINT IF EXISTS advance_orders_deposit_payment_mode_check`,
    sql`ALTER TABLE advance_orders ADD CONSTRAINT advance_orders_deposit_payment_mode_check
        CHECK (deposit_payment_mode IN ('CASH', 'GPAY', 'SPLIT', 'TVS', 'BAJAJ', 'HDP', 'DMI'))`,
  ]);
  console.log('payment mode constraints widened (CASH, GPAY, SPLIT + legacy TVS/BAJAJ/HDP/DMI).');
}

main().catch(console.error);
