// 在記憶體中的 Postgres 跑一次匯入 SQL，確認結餘與筆數
// 用法：node import.test.mjs <import.sql>
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const L = createRequire(import.meta.url)('../logic.js');
const db = new PGlite();
await db.exec(`
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create role authenticated; create role anon; create publication supabase_realtime;`);
await db.exec(fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8').replace(/create extension[^;]*;/, ''));
await db.exec(fs.readFileSync(process.argv[2], 'utf8'));
const rows = (await db.query('select * from expenses')).rows.map(r => ({ ...r, created_at: r.created_at.toISOString(), spent_on: r.spent_on.toISOString().slice(0,10) }));
const s = L.summarize(rows, [], 'jheyi');
const logs = (await db.query("select count(*)::int n from expense_logs where action='create' and actor='jheyi'")).rows[0].n;
await db.exec(fs.readFileSync(process.argv[2], 'utf8'));
const again = (await db.query('select count(*)::int n from expenses')).rows[0].n === rows.length ? 'no duplicates' : 'DUPLICATED';
console.log(JSON.stringify({ count: rows.length, balanceForJheyi: s.balance, logs, secondRun: again,
  sample: rows.filter(r => r.note.includes('#472') || r.note.includes('#474') || r.note.includes('#487')).map(r => [r.title, r.amount, r.payer, r.split_mode, r.payer_share, r.other_share, r.spent_on]) }));
