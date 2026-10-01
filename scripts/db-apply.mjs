// Applies supabase/schema.sql to your Supabase database.
//
//   Set SUPABASE_DB_URL in .env.local (Supabase → Connect → "Session pooler" URI), then:
//   npm run db:apply
//
// You can also just paste supabase/schema.sql into Supabase → SQL Editor and click Run.
import { readFileSync, existsSync } from 'node:fs';
import pg from 'pg';

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv('.env.local');

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error('SUPABASE_DB_URL is not set (add it to .env.local).');
  process.exit(1);
}

const sql = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query(sql);
  const { rows } = await client.query('select username, is_admin from public.profiles order by created_at');
  console.log('Schema applied. Users:', rows.map((r) => `${r.username}${r.is_admin ? ' (admin)' : ''}`).join(', '));
} finally {
  await client.end();
}
