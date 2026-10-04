// A batch can never hold negative stock. Concurrent sales that race for the last
// units used to push stock below zero; now the database rejects the loser's
// transaction and the app retries it against the fresh stock (see runWithStockRetry).
import { neon } from '@neondatabase/serverless';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf-8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=')[1].trim();

const sql = neon(dbUrl);

async function main() {
  const bad = await sql`SELECT id, stock_quantity FROM product_batches WHERE stock_quantity < 0`;
  if (bad.length) {
    console.error('Cannot add the constraint: these batches already have negative stock — fix them first:', bad);
    process.exit(1);
  }
  await sql`ALTER TABLE product_batches DROP CONSTRAINT IF EXISTS product_batches_stock_nonneg`;
  await sql`ALTER TABLE product_batches ADD CONSTRAINT product_batches_stock_nonneg CHECK (stock_quantity >= 0)`;
  console.log('product_batches_stock_nonneg added.');
}

main().catch(console.error);
