// 在記憶體中的 Postgres 跑一次匯入 SQL，確認結餘與筆數
// 用法：node import.test.mjs <import.sql>
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const L = createRequire(import.meta.url)('../logic.js');
const db = new PGlite();
const J = '00000000-0000-0000-0000-00000000000a', E = '00000000-0000-0000-0000-00000000000b';
await db.exec(`
  create schema auth; create table auth.users (id uuid primary key);
  insert into auth.users values ('${J}'),('${E}');
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(nullif(current_setting('test.uid', true),''), current_setting('request.jwt.claims', true)::json->>'sub')::uuid $$;
  create role authenticated; create role anon; create publication supabase_realtime;`);
await db.exec(fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8').replace(/create extension[^;]*;/, ''));
await db.exec(`select set_config('test.uid','${J}',false); select public.create_ledger('家','Jheyi');`);
const code = (await db.query('select invite_code from ledgers')).rows[0].invite_code;
await db.exec(`select set_config('test.uid','${E}',false); select public.join_ledger('${code}','Enting'); select set_config('test.uid','',false);`);
await db.exec(fs.readFileSync(process.argv[2], 'utf8'));
const rows = (await db.query('select * from expenses')).rows.map(r => ({ ...r, created_at: r.created_at.toISOString(), spent_on: r.spent_on.toISOString().slice(0,10) }));
const s = L.summarize(rows, [], J);
const logs = (await db.query("select count(*)::int n from expense_logs where action='create' and actor=$1", [J])).rows[0].n;
let again = 'ok'; try { await db.exec(fs.readFileSync(process.argv[2], 'utf8')); again = 'ran twice!'; } catch (e) { again = e.message; }
console.log(JSON.stringify({ count: rows.length, balanceForJheyi: s.balance, logs, secondRun: again,
  sample: rows.filter(r => r.note.includes('#472') || r.note.includes('#474') || r.note.includes('#487')).map(r => [r.title, r.amount, r.payer === J ? 'Jheyi' : 'Enting', r.split_mode, r.payer_share, r.other_share, r.spent_on]) }));
