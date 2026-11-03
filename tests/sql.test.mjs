// 用 PGlite（記憶體中的 Postgres）模擬 Supabase，測試 schema.sql 的規則
import { PGlite } from '@electric-sql/pglite';

import fs from 'node:fs';

const db = new PGlite();
const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';

await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key);
  insert into auth.users values ('${A}'),('${B}'),('${C}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
  create role authenticated;
  create role anon;
  create publication supabase_realtime;
  grant usage on schema auth to authenticated;
`);
await db.exec(fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8').replace(/create extension[^;]*;/, ''));
await db.exec(`
  grant usage on schema public to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant usage on all sequences in schema public to authenticated;
`);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('FAIL', m); } };
async function as(uid, sql, params = []) {
  await db.exec(`reset role; select set_config('test.uid', '${uid}', false); set role authenticated;`);
  try { return { rows: (await db.query(sql, params)).rows }; }
  catch (e) { return { error: e.message }; }
  finally { await db.exec('reset role;'); }
}

// 建帳本、加入
const lid = (await as(A, `select public.create_ledger('家', '我') as id`)).rows[0].id;
ok(lid, 'create ledger');
const code = (await as(A, `select invite_code from ledgers`)).rows[0].invite_code;
ok(/^[2-9A-HJ-NP-Z]{6}$/.test(code), 'invite code format ' + code);
ok((await as(B, `select * from ledgers`)).rows.length === 0, 'B cannot see before joining');
ok(!(await as(B, `select public.join_ledger('${code.toLowerCase()}', '小晴')`)).error, 'B joins (lowercase code)');
ok((await as(C, `select public.join_ledger('${code}', '路人')`)).error?.includes('兩個人'), 'third person rejected');
ok((await as(C, `select * from expenses`)).rows.length === 0, 'C sees nothing');

// A 新增支出：A 付 1280 均分，立即生效
const ins = await as(A, `insert into expenses (ledger_id,title,category,amount,payer,split_mode,payer_share,other_share)
  values ($1,'晚餐','餐飲',1280,$2,'equal',640,0) returning *`, [lid, A]);
ok(!ins.error, 'insert ' + ins.error);
const e = ins.rows[0];
ok(e.other_share === 640 && e.created_by === A, 'other_share computed, created_by forced');
ok((await as(B, `select * from expenses where id=$1`, [e.id])).rows.length === 1, 'B sees it immediately');
ok((await as(C, `insert into expenses (ledger_id,title,amount,payer,split_mode,payer_share,other_share) values ($1,'x',10,$2,'equal',5,5)`, [lid, C])).error, 'outsider insert blocked');
ok((await as(A, `insert into expenses (ledger_id,title,amount,payer,split_mode,payer_share,other_share) values ($1,'x',10,$2,'equal',5,5)`, [lid, C])).error, 'non-member payer blocked');
ok((await as(A, `insert into expenses (ledger_id,title,amount,payer,split_mode,payer_share,other_share) values ($1,'x',10,$2,'equal',50,0)`, [lid, A])).error, 'share > amount blocked');

// B 直接修改 A 的帳
await as(B, `update expenses set amount=1300, payer_share=650 where id=$1`, [e.id]);
const after = (await as(A, `select * from expenses where id=$1`, [e.id])).rows[0];
ok(after.amount === 1300 && after.other_share === 650 && after.last_edited_by === B, 'B edits freely');
await as(A, `update expenses set amount=1300 where id=$1`, [e.id]);  // 沒改內容
ok((await as(C, `update expenses set amount=1 where id=$1`, [e.id])) && (await as(A, `select amount from expenses where id=$1`, [e.id])).rows[0].amount === 1300, 'outsider cannot edit');
await as(A, `update expenses set deleted_at=now() where id=$1`, [e.id]);
const logs = (await as(B, `select action, actor from expense_logs where expense_id=$1 order by id`, [e.id])).rows;
ok(JSON.stringify(logs.map(r => r.action)) === '["create","edit","delete"]', 'logs ' + JSON.stringify(logs.map(r => r.action)));
ok(logs[1].actor === B, 'edit attributed to B');
ok((await as(A, `insert into expense_logs (ledger_id,expense_id,action) values ($1,$2,'fake')`, [lid, e.id])).error, 'cannot forge logs');

// 結清：立即生效，任一方可刪除，外人不行
const s = (await as(B, `insert into settlements (ledger_id,from_user,to_user,amount,method) values ($1,$2,$3,650,'transfer') returning *`, [lid, B, A]));
ok(!s.error && s.rows[0].created_by === B, 'settlement inserted ' + s.error);
const sid = s.rows[0].id;
ok((await as(C, `insert into settlements (ledger_id,from_user,to_user,amount,method) values ($1,$2,$3,1,'cash')`, [lid, C, A])).error, 'outsider settlement blocked');
await as(C, `delete from settlements where id=$1`, [sid]);
ok((await as(A, `select 1 from settlements where id=$1`, [sid])).rows.length === 1, 'outsider cannot delete');
await as(A, `update settlements set amount=1 where id=$1`, [sid]);
ok((await as(A, `select amount from settlements where id=$1`, [sid])).rows[0].amount === 650, 'settlement not editable');
await as(A, `delete from settlements where id=$1`, [sid]);
ok((await as(B, `select 1 from settlements where id=$1`, [sid])).rows.length === 0, 'member can delete settlement');

console.log(`SQL tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
