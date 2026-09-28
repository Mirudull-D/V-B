import { neon } from '@neondatabase/serverless';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf-8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=')[1].trim();

const sql = neon(dbUrl);

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS services (
        id         TEXT        PRIMARY KEY,
        name       TEXT        NOT NULL UNIQUE,
        price      NUMERIC(10, 2) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  console.log("Services table created!");
}

main().catch(console.error);
