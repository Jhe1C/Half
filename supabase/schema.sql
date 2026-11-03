-- ============================================================
-- HALF 雙人拆帳 · Supabase 資料庫結構
-- 在新的 Supabase 專案 → SQL Editor 貼上整份執行一次。
-- 固定兩個人：jheyi、enting。兩人共用一個登入帳號（每台裝置輸入一次密碼），
-- 進入後在裝置上選「我是誰」。
-- 金額一律以「新台幣整數元」儲存。
-- 兩人互相信任：任何一方新增、修改、刪除、結清都立即生效；修改紀錄會自動保留。
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- 資料表 ----------

-- 兩個人
create table if not exists public.people (
  id            text primary key check (id in ('jheyi', 'enting')),
  display_name  text not null check (char_length(display_name) between 1 and 20),
  ratio         int  not null default 50 check (ratio between 0 and 100), -- 「比例」拆法時此人負擔的百分比
  sort          int  not null default 0
);
insert into public.people (id, display_name, sort) values ('jheyi', 'Jheyi', 1), ('enting', 'Enting', 2)
  on conflict (id) do nothing;

-- 帳本設定（只有一列）
create table if not exists public.settings (
  id                int primary key default 1 check (id = 1),
  name              text not null default '我們的帳本',
  category_defaults jsonb not null default '{"餐飲":"equal","日用":"equal","居住":"equal","交通":"equal","娛樂":"equal","其他":"equal"}'
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- 支出
create table if not exists public.expenses (
  id              uuid primary key default gen_random_uuid(),
  title           text not null check (char_length(title) between 1 and 60),
  category        text not null default '其他' check (char_length(category) between 1 and 12),
  amount          int  not null check (amount > 0 and amount <= 10000000),
  payer           text not null references public.people(id),
  split_mode      text not null check (split_mode in ('equal','ratio','fixed','full')),
  payer_share     int  not null,               -- 付款人自己負擔的金額
  other_share     int  not null,               -- 另一人負擔的金額（= 對方欠付款人的錢）
  spent_on        date not null default current_date,
  place           text check (char_length(place) <= 60),
  note            text check (char_length(note) <= 300),
  created_by      text not null references public.people(id),
  last_edited_by  text not null references public.people(id),
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (payer_share >= 0 and other_share >= 0 and payer_share + other_share = amount)
);
create index if not exists expenses_spent_idx on public.expenses (spent_on desc);

-- 結清（付款紀錄）
create table if not exists public.settlements (
  id            uuid primary key default gen_random_uuid(),
  from_user     text not null references public.people(id),   -- 付錢的人
  to_user       text not null references public.people(id),   -- 收錢的人
  amount        int  not null check (amount > 0 and amount <= 10000000),
  method        text not null check (method in ('transfer','cash','other')),
  note          text check (char_length(note) <= 100),
  created_by    text not null references public.people(id),
  created_at    timestamptz not null default now(),
  check (from_user <> to_user)
);
create index if not exists settlements_created_idx on public.settlements (created_at desc);

-- 修改紀錄（只由觸發器寫入）
create table if not exists public.expense_logs (
  id          bigserial primary key,
  expense_id  uuid not null references public.expenses(id) on delete cascade,
  actor       text references public.people(id),
  action      text not null,          -- create / edit / delete / restore
  detail      jsonb not null default '{}',
  at          timestamptz not null default now()
);
create index if not exists expense_logs_expense_idx on public.expense_logs (expense_id, at);

-- ---------- 觸發器：維持規則 ----------

create or replace function public.expenses_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.other_share := new.amount - new.payer_share;
  if tg_op = 'INSERT' then
    new.last_edited_by := new.created_by;
    new.deleted_at := null;
    return new;
  end if;
  -- UPDATE：任何一方都能直接修改，立即生效
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();
  if new.deleted_at is distinct from old.deleted_at then return new; end if;
  -- 內容沒有改變：略過這次更新，不留空白紀錄
  if (new.title, new.category, new.amount, new.payer, new.split_mode, new.payer_share,
      new.spent_on, new.place, new.note)
     is not distinct from
     (old.title, old.category, old.amount, old.payer, old.split_mode, old.payer_share,
      old.spent_on, old.place, old.note) then
    return null;
  end if;
  return new;
end $$;

drop trigger if exists expenses_guard on public.expenses;
create trigger expenses_guard before insert or update on public.expenses
  for each row execute function public.expenses_guard();

create or replace function public.expenses_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_action text;
  v_detail jsonb := '{}';
begin
  if tg_op = 'INSERT' then
    v_action := 'create';
    v_detail := jsonb_build_object('amount', new.amount);
  elsif new.deleted_at is not null and old.deleted_at is null then
    v_action := 'delete';
  elsif new.deleted_at is null and old.deleted_at is not null then
    v_action := 'restore';
  else
    v_action := 'edit';
    if new.amount <> old.amount then
      v_detail := v_detail || jsonb_build_object('amount', jsonb_build_array(old.amount, new.amount));
    end if;
    if new.title <> old.title then
      v_detail := v_detail || jsonb_build_object('title', jsonb_build_array(old.title, new.title));
    end if;
    if new.payer <> old.payer then
      v_detail := v_detail || jsonb_build_object('payer', true);
    end if;
    if new.split_mode <> old.split_mode or (new.split_mode = 'fixed' and new.payer_share <> old.payer_share) then
      v_detail := v_detail || jsonb_build_object('split', jsonb_build_array(old.split_mode, new.split_mode));
    end if;
  end if;
  insert into public.expense_logs (expense_id, actor, action, detail)
    values (new.id, new.last_edited_by, v_action, v_detail);
  return null;
end $$;

drop trigger if exists expenses_log on public.expenses;
create trigger expenses_log after insert or update on public.expenses
  for each row execute function public.expenses_log();

-- ---------- 只允許一個共用登入帳號 ----------
-- 共用帳號建立後，任何人都無法再註冊新帳號（在資料庫層擋下）。
create or replace function public.only_one_account()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from auth.users) then
    raise exception '這個帳本不開放註冊';
  end if;
  return new;
end $$;

drop trigger if exists only_one_account on auth.users;
create trigger only_one_account before insert on auth.users
  for each row execute function public.only_one_account();

-- ---------- Row Level Security ----------
-- 未登入（anon）什麼都看不到也改不了；登入的共用帳號可以讀寫。

alter table public.people       enable row level security;
alter table public.settings     enable row level security;
alter table public.expenses     enable row level security;
alter table public.settlements  enable row level security;
alter table public.expense_logs enable row level security;

drop policy if exists people_select on public.people;
create policy people_select on public.people for select to authenticated using (true);
drop policy if exists people_update on public.people;
create policy people_update on public.people for update to authenticated using (true) with check (true);
drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings for select to authenticated using (true);
drop policy if exists settings_update on public.settings;
create policy settings_update on public.settings for update to authenticated using (true) with check (true);
drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses for select to authenticated using (true);
drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses for insert to authenticated with check (true);
drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses for update to authenticated using (true) with check (true);
drop policy if exists settlements_select on public.settlements;
create policy settlements_select on public.settlements for select to authenticated using (true);
drop policy if exists settlements_insert on public.settlements;
create policy settlements_insert on public.settlements for insert to authenticated with check (true);
drop policy if exists settlements_delete on public.settlements;
create policy settlements_delete on public.settlements for delete to authenticated using (true);
drop policy if exists logs_select on public.expense_logs;
create policy logs_select on public.expense_logs for select to authenticated using (true);

-- 觸發器函式不需要被任何人直接呼叫
revoke execute on function public.expenses_guard()   from public, anon, authenticated;
revoke execute on function public.expenses_log()     from public, anon, authenticated;
revoke execute on function public.only_one_account() from public, anon, authenticated;

-- ---------- 即時同步 ----------
do $$
begin
  begin alter publication supabase_realtime add table public.expenses;    exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.settlements; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.people;      exception when duplicate_object then null; end;
end $$;
