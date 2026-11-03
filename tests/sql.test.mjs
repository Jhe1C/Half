// 用 PGlite（記憶體中的 Postgres）模擬 Supabase，測試 schema.sql 的規則
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const db = new PGlite();
const U = '00000000-0000-0000-0000-00000000000a';

await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
  create role authenticated; create role anon;
  create publication supabase_realtime;
`);
await db.exec(fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8').replace(/create extension[^;]*;/, ''));
await db.exec(`
  grant usage on schema public to authenticated, anon;
  grant select, insert, update, delete on all tables in schema public to authenticated, anon;
  grant usage on all sequences in schema public to authenticated, anon;
`);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
async function as(role, sql, params = []) {
  await db.exec(`reset role; set role ${role};`);
  try { return { rows: (await db.query(sql, params)).rows }; }
  catch (e) { return { error: e.message }; }
  finally { await db.exec('reset role;'); }
}

// 只允許一個帳號
await db.exec(`insert into auth.users values ('${U}')`);
let second = null; try { await db.exec(`insert into auth.users values ('00000000-0000-0000-0000-00000000000b')`); } catch (e) { second = e.message; }
ok(second && second.includes('不開放註冊'), 'second account blocked');

// 預設兩個人
const people = (await as('authenticated', 'select id, display_name from people order by sort')).rows;
ok(people.map(p => p.id).join() === 'jheyi,enting', 'two people seeded');

// 未登入：看不到、寫不進
ok((await as('anon', 'select * from people')).rows.length === 0, 'anon cannot read people');
ok((await as('anon', `insert into expenses (title,amount,payer,split_mode,payer_share,other_share,created_by,last_edited_by) values ('x',10,'jheyi','equal',5,5,'jheyi','jheyi')`)).error, 'anon cannot insert');

// 登入：新增立即生效
const ins = await as('authenticated', `insert into expenses (title,category,amount,payer,split_mode,payer_share,other_share,created_by,last_edited_by)
  values ('晚餐','餐飲',1280,'jheyi','equal',640,0,'jheyi','enting') returning *`);
ok(!ins.error, 'insert ' + ins.error);
const e = ins.rows[0];
ok(e.other_share === 640 && e.last_edited_by === 'jheyi', 'other_share computed, last_edited_by = created_by');
ok((await as('authenticated', `insert into expenses (title,amount,payer,split_mode,payer_share,other_share,created_by,last_edited_by) values ('x',10,'nobody','equal',5,5,'jheyi','jheyi')`)).error, 'unknown payer blocked');
ok((await as('authenticated', `insert into expenses (title,amount,payer,split_mode,payer_share,other_share,created_by,last_edited_by) values ('x',10,'jheyi','equal',50,0,'jheyi','jheyi')`)).error, 'share > amount blocked');

// Enting 修改
await as('authenticated', `update expenses set amount=1300, payer_share=650, last_edited_by='enting' where id=$1`, [e.id]);
const after = (await as('authenticated', `select * from expenses where id=$1`, [e.id])).rows[0];
ok(after.amount === 1300 && after.other_share === 650 && after.last_edited_by === 'enting' && after.created_by === 'jheyi', 'enting edits');
await as('authenticated', `update expenses set amount=1300 where id=$1`, [e.id]);  // 沒改內容
await as('anon', `update expenses set amount=1 where id=$1`, [e.id]);
ok((await as('authenticated', `select amount from expenses where id=$1`, [e.id])).rows[0].amount === 1300, 'anon cannot edit');
await as('authenticated', `update expenses set deleted_at=now(), last_edited_by='jheyi' where id=$1`, [e.id]);
const logs = (await as('authenticated', `select action, actor from expense_logs where expense_id=$1 order by id`, [e.id])).rows;
ok(JSON.stringify(logs.map(r => r.action)) === '["create","edit","delete"]', 'logs ' + JSON.stringify(logs.map(r => r.action)));
ok(logs[1].actor === 'enting' && logs[2].actor === 'jheyi', 'log actors');
ok((await as('authenticated', `insert into expense_logs (expense_id,action) values ($1,'fake')`, [e.id])).error, 'cannot forge logs');
ok((await as('anon', `select * from expense_logs`)).rows.length === 0, 'anon cannot read logs');

// 結清
const s = await as('authenticated', `insert into settlements (from_user,to_user,amount,method,created_by) values ('enting','jheyi',650,'transfer','enting') returning *`);
ok(!s.error, 'settlement ' + s.error);
ok((await as('authenticated', `insert into settlements (from_user,to_user,amount,method,created_by) values ('jheyi','jheyi',1,'cash','jheyi')`)).error, 'self settlement blocked');
await as('authenticated', `update settlements set amount=1 where id=$1`, [s.rows[0].id]);
ok((await as('authenticated', `select amount from settlements where id=$1`, [s.rows[0].id])).rows[0].amount === 650, 'settlement not editable');
await as('anon', `delete from settlements where id=$1`, [s.rows[0].id]);
ok((await as('authenticated', `select 1 from settlements`)).rows.length === 1, 'anon cannot delete');
await as('authenticated', `delete from settlements where id=$1`, [s.rows[0].id]);
ok((await as('authenticated', `select 1 from settlements`)).rows.length === 0, 'member can delete settlement');

// 設定
await as('authenticated', `update people set ratio=60 where id='jheyi'`);
ok((await as('authenticated', `select ratio from people where id='jheyi'`)).rows[0].ratio === 60, 'update ratio');
await as('anon', `update people set display_name='hack' where id='jheyi'`);
ok((await as('authenticated', `select display_name from people where id='jheyi'`)).rows[0].display_name === 'Jheyi', 'anon cannot rename');

console.log(`SQL tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
