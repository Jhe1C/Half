-- ============================================================
-- HALF 雙人拆帳 · Supabase 資料庫結構
-- 在 Supabase 後台 → SQL Editor 貼上整份執行一次即可。
-- 金額一律以「新台幣整數元」儲存。
-- 兩人互相信任：任何一方新增、修改、刪除、結清都立即生效；修改紀錄會自動保留。
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- 資料表 ----------

-- 帳本：一個帳本 = 兩個人共用的一本帳
create table if not exists public.ledgers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null default '我們的帳本' check (char_length(name) between 1 and 40),
  invite_code   text not null unique,
  category_defaults jsonb not null default '{"餐飲":"equal","日用":"equal","居住":"equal","交通":"equal","娛樂":"equal","其他":"equal"}',
  created_by    uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now()
);

-- 成員：每本帳最多兩人
create table if not exists public.members (
  ledger_id     uuid not null references public.ledgers(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 20),
  ratio         int  not null default 50 check (ratio between 0 and 100), -- 「比例」拆法時此人負擔的百分比
  joined_at     timestamptz not null default now(),
  primary key (ledger_id, user_id)
);

-- 支出
create table if not exists public.expenses (
  id              uuid primary key default gen_random_uuid(),
  ledger_id       uuid not null references public.ledgers(id) on delete cascade,
  title           text not null check (char_length(title) between 1 and 60),
  category        text not null default '其他' check (char_length(category) between 1 and 12),
  amount          int  not null check (amount > 0 and amount <= 10000000),
  payer           uuid not null references auth.users(id),
  split_mode      text not null check (split_mode in ('equal','ratio','fixed','full')),
  payer_share     int  not null,               -- 付款人自己負擔的金額
  other_share     int  not null,               -- 另一人負擔的金額（= 對方欠付款人的錢）
  spent_on        date not null default current_date,
  place           text check (char_length(place) <= 60),
  note            text check (char_length(note) <= 300),
  created_by      uuid not null references auth.users(id),
  last_edited_by  uuid not null references auth.users(id),
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (payer_share >= 0 and other_share >= 0 and payer_share + other_share = amount)
);
create index if not exists expenses_ledger_idx on public.expenses (ledger_id, spent_on desc);

-- 結清（付款紀錄）
create table if not exists public.settlements (
  id            uuid primary key default gen_random_uuid(),
  ledger_id     uuid not null references public.ledgers(id) on delete cascade,
  from_user     uuid not null references auth.users(id),   -- 付錢的人
  to_user       uuid not null references auth.users(id),   -- 收錢的人
  amount        int  not null check (amount > 0 and amount <= 10000000),
  method        text not null check (method in ('transfer','cash','other')),
  note          text check (char_length(note) <= 100),
  created_by    uuid not null references auth.users(id),
  created_at    timestamptz not null default now(),
  check (from_user <> to_user)
);
create index if not exists settlements_ledger_idx on public.settlements (ledger_id, created_at desc);

-- 修改紀錄（只由觸發器寫入）
create table if not exists public.expense_logs (
  id          bigserial primary key,
  ledger_id   uuid not null references public.ledgers(id) on delete cascade,
  expense_id  uuid not null references public.expenses(id) on delete cascade,
  actor       uuid references auth.users(id),
  action      text not null,          -- create / edit / delete / restore
  detail      jsonb not null default '{}',
  at          timestamptz not null default now()
);
create index if not exists expense_logs_expense_idx on public.expense_logs (expense_id, at);

-- ---------- 權限輔助函式 ----------

create or replace function public.is_member(lid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where ledger_id = lid and user_id = auth.uid());
$$;

create or replace function public.is_member_of(lid uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where ledger_id = lid and user_id = uid);
$$;

-- ---------- 帳本建立與加入（RPC） ----------

create or replace function public.create_ledger(p_name text, p_display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_code text;
begin
  if auth.uid() is null then raise exception '請先登入'; end if;
  loop
    -- 6 碼邀請碼，排除容易看錯的 0 O 1 I
    v_code := (select string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + floor(random()*32)::int, 1), '')
               from generate_series(1,6));
    exit when not exists (select 1 from public.ledgers where invite_code = v_code);
  end loop;
  insert into public.ledgers (name, invite_code, created_by)
    values (coalesce(nullif(trim(p_name),''), '我們的帳本'), v_code, auth.uid())
    returning id into v_id;
  insert into public.members (ledger_id, user_id, display_name)
    values (v_id, auth.uid(), trim(p_display_name));
  return v_id;
end $$;

create or replace function public.join_ledger(p_code text, p_display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_count int;
begin
  if auth.uid() is null then raise exception '請先登入'; end if;
  select id into v_id from public.ledgers where invite_code = upper(trim(p_code));
  if v_id is null then raise exception '找不到這個邀請碼'; end if;
  if public.is_member(v_id) then return v_id; end if;
  select count(*) into v_count from public.members where ledger_id = v_id;
  if v_count >= 2 then raise exception '這本帳已經有兩個人了'; end if;
  insert into public.members (ledger_id, user_id, display_name)
    values (v_id, auth.uid(), trim(p_display_name));
  return v_id;
end $$;

-- ---------- 觸發器：維持規則 ----------

create or replace function public.expenses_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not public.is_member_of(new.ledger_id, new.payer) then raise exception '付款人必須是帳本成員'; end if;
    new.created_by := auth.uid();
    new.last_edited_by := auth.uid();
    new.deleted_at := null;
    new.other_share := new.amount - new.payer_share;
    return new;
  end if;

  -- UPDATE（雙方互相信任：任何一方都能直接修改，立即生效）
  new.ledger_id := old.ledger_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  if not public.is_member_of(new.ledger_id, new.payer) then raise exception '付款人必須是帳本成員'; end if;
  new.other_share := new.amount - new.payer_share;
  new.updated_at := now();

  if new.deleted_at is distinct from old.deleted_at then
    new.last_edited_by := auth.uid();
    return new;
  end if;

  -- 內容沒有改變：略過這次更新，不留空白紀錄
  if (new.title, new.category, new.amount, new.payer, new.split_mode, new.payer_share,
      new.spent_on, new.place, new.note)
     is not distinct from
     (old.title, old.category, old.amount, old.payer, old.split_mode, old.payer_share,
      old.spent_on, old.place, old.note) then
    return null;
  end if;

  new.last_edited_by := auth.uid();
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
  insert into public.expense_logs (ledger_id, expense_id, actor, action, detail)
    values (new.ledger_id, new.id, auth.uid(), v_action, v_detail);
  return null;
end $$;

drop trigger if exists expenses_log on public.expenses;
create trigger expenses_log after insert or update on public.expenses
  for each row execute function public.expenses_log();

create or replace function public.settlements_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_member_of(new.ledger_id, new.from_user) and public.is_member_of(new.ledger_id, new.to_user)) then
    raise exception '結清的兩方都必須是帳本成員';
  end if;
  new.created_by := auth.uid();
  return new;
end $$;

drop trigger if exists settlements_guard on public.settlements;
create trigger settlements_guard before insert on public.settlements
  for each row execute function public.settlements_guard();

-- ---------- Row Level Security ----------

alter table public.ledgers      enable row level security;
alter table public.members      enable row level security;
alter table public.expenses     enable row level security;
alter table public.settlements  enable row level security;
alter table public.expense_logs enable row level security;

drop policy if exists ledgers_select on public.ledgers;
create policy ledgers_select on public.ledgers for select using (public.is_member(id));
drop policy if exists ledgers_update on public.ledgers;
create policy ledgers_update on public.ledgers for update using (public.is_member(id)) with check (public.is_member(id));

drop policy if exists members_select on public.members;
create policy members_select on public.members for select using (public.is_member(ledger_id));
drop policy if exists members_update on public.members;
create policy members_update on public.members for update using (public.is_member(ledger_id)) with check (public.is_member(ledger_id));

drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses for select using (public.is_member(ledger_id));
drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses for insert with check (public.is_member(ledger_id));
drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses for update using (public.is_member(ledger_id)) with check (public.is_member(ledger_id));

drop policy if exists settlements_select on public.settlements;
create policy settlements_select on public.settlements for select using (public.is_member(ledger_id));
drop policy if exists settlements_insert on public.settlements;
create policy settlements_insert on public.settlements for insert with check (public.is_member(ledger_id));
-- 結清記錯了可以刪除（任一方）
drop policy if exists settlements_delete on public.settlements;
create policy settlements_delete on public.settlements for delete using (public.is_member(ledger_id));

drop policy if exists logs_select on public.expense_logs;
create policy logs_select on public.expense_logs for select using (public.is_member(ledger_id));

grant execute on function public.create_ledger(text, text)  to authenticated;
grant execute on function public.join_ledger(text, text)    to authenticated;

-- ---------- 即時同步 ----------
do $$
begin
  begin alter publication supabase_realtime add table public.expenses;    exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.settlements; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.members;     exception when duplicate_object then null; end;
end $$;

-- ---------- 函式權限收斂 ----------
-- 觸發器函式不需要被任何人直接呼叫
revoke execute on function public.expenses_guard()    from public, anon, authenticated;
revoke execute on function public.expenses_log()      from public, anon, authenticated;
revoke execute on function public.settlements_guard() from public, anon, authenticated;
-- 其他函式只給登入的人用（RLS 規則需要 is_member / is_member_of）
revoke execute on function public.is_member(uuid)               from public, anon;
revoke execute on function public.is_member_of(uuid, uuid)      from public, anon;
revoke execute on function public.create_ledger(text, text)     from public, anon;
revoke execute on function public.join_ledger(text, text)       from public, anon;
grant  execute on function public.is_member(uuid)               to authenticated;
grant  execute on function public.is_member_of(uuid, uuid)      to authenticated;
