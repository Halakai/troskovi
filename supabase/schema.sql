-- =====================================================================
--  Troškovi – database schema for Supabase
--
--  Run the whole file once in Supabase → SQL Editor (or `npm run db:apply`).
--  It is safe to re-run: tables are created only if missing, functions and
--  policies are replaced, and seed data is only inserted into empty tables.
--
--  Login works with username + password. Supabase Auth needs an e-mail, so
--  every username is mapped to "<username>@troskovi.invalid" (the .invalid
--  domain can never receive mail). Keep USERNAME_EMAIL_DOMAIN in
--  src/config.ts in sync with public._email_for() below.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
--  Tables
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text not null unique check (username ~ '^[a-z0-9._-]{2,32}$'),
  display_name text not null check (length(trim(display_name)) between 1 and 40),
  is_admin     boolean not null default false,
  active       boolean not null default true,
  color        text not null default '#6366f1',
  created_at   timestamptz not null default now()
);

-- owner_id NULL = shared category, otherwise private to that person
-- (private categories are only offered in the owner's picker, but expenses
-- that use them are visible to everyone).
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) between 1 and 40),
  emoji      text not null default '📦',
  color      text not null default '#64748b',
  owner_id   uuid references public.profiles(id) on delete cascade,
  is_system  boolean not null default false,   -- the undeletable "Other" category
  sort_order integer not null default 100,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists categories_single_system on public.categories (is_system) where is_system;

-- Monthly limit per category. A row applies from effective_from (1st of a
-- month) until the next row, so changing a limit never rewrites history.
-- amount_cents NULL = "no limit from this month on".
create table if not exists public.category_limits (
  category_id    uuid not null references public.categories(id) on delete cascade,
  effective_from date not null check (extract(day from effective_from) = 1),
  amount_cents   integer check (amount_cents is null or amount_cents >= 0),
  primary key (category_id, effective_from)
);

-- Templates for things that repeat every month (rent, loan, salary, …).
-- person_id NULL = shared.
create table if not exists public.recurring (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null default 'expense' check (kind in ('expense', 'income')),
  name           text not null check (length(trim(name)) between 1 and 60),
  amount_cents   integer not null check (amount_cents > 0),
  category_id    uuid references public.categories(id) on delete restrict,
  person_id      uuid references public.profiles(id) on delete restrict,
  day_of_month   smallint not null check (day_of_month between 1 and 31),
  start_month    date not null default date_trunc('month', current_date)::date check (extract(day from start_month) = 1),
  end_month      date check (end_month is null or extract(day from end_month) = 1),
  posted_through date,   -- last month (1st) for which a transaction was created
  active         boolean not null default true,
  created_by     uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at     timestamptz not null default now()
);

-- Expenses and incomes. person_id NULL = shared (e.g. rent).
create table if not exists public.transactions (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null default 'expense' check (kind in ('expense', 'income')),
  amount_cents integer not null check (amount_cents > 0),
  category_id  uuid references public.categories(id) on delete restrict,
  person_id    uuid references public.profiles(id) on delete restrict,
  date         date not null default current_date,
  note         text check (note is null or length(note) <= 200),
  recurring_id uuid references public.recurring(id) on delete set null,
  created_by   uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists transactions_date_idx on public.transactions (date);

-- ---------------------------------------------------------------------
--  Helpers
-- ---------------------------------------------------------------------

create or replace function public._email_for(p_username text) returns text
language sql immutable set search_path = '' as $$
  select lower(trim(p_username)) || '@troskovi.invalid'
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and is_admin)
$$;

create or replace function public._check_username(p_username text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_username !~ '^[a-z0-9._-]{2,32}$' then
    raise exception 'Username must be 2–32 characters: letters, numbers, dot, dash or underscore';
  end if;
end $$;

create or replace function public._check_password(p_password text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if length(coalesce(p_password, '')) < 4 then
    raise exception 'Password must be at least 4 characters';
  end if;
end $$;

-- ---------------------------------------------------------------------
--  Triggers
-- ---------------------------------------------------------------------

create or replace function public.tg_transactions_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end $$;

drop trigger if exists transactions_before_update on public.transactions;
create trigger transactions_before_update before update on public.transactions
  for each row execute function public.tg_transactions_before_update();

create or replace function public.tg_categories_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.is_system := old.is_system;
  if new.is_system then new.owner_id := null; end if;
  return new;
end $$;

drop trigger if exists categories_before_update on public.categories;
create trigger categories_before_update before update on public.categories
  for each row execute function public.tg_categories_before_update();

-- Deleting a category moves everything that used it to "Other".
create or replace function public.tg_categories_before_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_other uuid;
begin
  if old.is_system then
    raise exception 'The "%" category cannot be deleted', old.name;
  end if;
  select id into v_other from public.categories where is_system limit 1;
  update public.transactions set category_id = v_other where category_id = old.id;
  update public.recurring    set category_id = v_other where category_id = old.id;
  return old;
end $$;

drop trigger if exists categories_before_delete on public.categories;
create trigger categories_before_delete before delete on public.categories
  for each row execute function public.tg_categories_before_delete();

-- ---------------------------------------------------------------------
--  Row level security
--    * everyone who has an active profile sees everything
--    * anyone can add; normal users edit only what they added
--    * only the admin deletes transactions
-- ---------------------------------------------------------------------

alter table public.profiles        enable row level security;
alter table public.categories      enable row level security;
alter table public.category_limits enable row level security;
alter table public.recurring       enable row level security;
alter table public.transactions    enable row level security;

-- profiles: read-only from the client, changed only through admin functions
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (public.is_member() or id = auth.uid());

-- categories
drop policy if exists categories_select on public.categories;
create policy categories_select on public.categories for select to authenticated
  using (public.is_member());

drop policy if exists categories_insert on public.categories;
create policy categories_insert on public.categories for insert to authenticated
  with check (public.is_member() and not is_system and (owner_id is null or owner_id = auth.uid()));

drop policy if exists categories_update on public.categories;
create policy categories_update on public.categories for update to authenticated
  using (public.is_admin() or (public.is_member() and (owner_id is null or owner_id = auth.uid())))
  with check (public.is_admin() or (public.is_member() and (owner_id is null or owner_id = auth.uid())));

drop policy if exists categories_delete on public.categories;
create policy categories_delete on public.categories for delete to authenticated
  using (not is_system and (public.is_admin() or (public.is_member() and owner_id = auth.uid())));

-- category limits
drop policy if exists category_limits_select on public.category_limits;
create policy category_limits_select on public.category_limits for select to authenticated
  using (public.is_member());

drop policy if exists category_limits_write on public.category_limits;
create policy category_limits_write on public.category_limits for all to authenticated
  using (public.is_member() and exists (
    select 1 from public.categories c where c.id = category_id
      and (c.owner_id is null or c.owner_id = auth.uid() or public.is_admin())))
  with check (public.is_member() and exists (
    select 1 from public.categories c where c.id = category_id
      and (c.owner_id is null or c.owner_id = auth.uid() or public.is_admin())));

-- recurring templates
drop policy if exists recurring_select on public.recurring;
create policy recurring_select on public.recurring for select to authenticated
  using (public.is_member());

drop policy if exists recurring_insert on public.recurring;
create policy recurring_insert on public.recurring for insert to authenticated
  with check (public.is_member() and created_by = auth.uid());

drop policy if exists recurring_update on public.recurring;
create policy recurring_update on public.recurring for update to authenticated
  using (public.is_admin() or (public.is_member() and created_by = auth.uid()))
  with check (public.is_admin() or (public.is_member() and created_by = auth.uid()));

drop policy if exists recurring_delete on public.recurring;
create policy recurring_delete on public.recurring for delete to authenticated
  using (public.is_admin() or (public.is_member() and created_by = auth.uid()));

-- transactions
drop policy if exists transactions_select on public.transactions;
create policy transactions_select on public.transactions for select to authenticated
  using (public.is_member());

drop policy if exists transactions_insert on public.transactions;
create policy transactions_insert on public.transactions for insert to authenticated
  with check (public.is_member() and created_by = auth.uid());

drop policy if exists transactions_update on public.transactions;
create policy transactions_update on public.transactions for update to authenticated
  using (public.is_admin() or (public.is_member() and created_by = auth.uid()))
  with check (public.is_admin() or (public.is_member() and created_by = auth.uid()));

drop policy if exists transactions_delete on public.transactions;
create policy transactions_delete on public.transactions for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------
--  User management (all usernames / passwords live in auth.users)
-- ---------------------------------------------------------------------

-- Internal: creates the auth user + identity + profile. Not callable from the app.
create or replace function public._create_user(
  p_username text, p_password text, p_display_name text, p_is_admin boolean, p_color text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id       uuid := gen_random_uuid();
  v_username text := lower(trim(p_username));
  v_email    text;
begin
  perform public._check_username(v_username);
  perform public._check_password(p_password);
  if exists (select 1 from public.profiles where username = v_username) then
    raise exception 'Username "%" is already taken', v_username;
  end if;
  v_email := public._email_for(v_username);

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('username', v_username),
    now(), now(), '', '', '', ''
  );

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text,
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
          'email', now(), now(), now());

  insert into public.profiles (id, username, display_name, is_admin, color)
  values (v_id, v_username, coalesce(nullif(trim(p_display_name), ''), v_username), p_is_admin,
          coalesce(nullif(p_color, ''), '#6366f1'));

  return v_id;
end $$;

create or replace function public.admin_create_user(
  p_username text, p_password text, p_display_name text, p_is_admin boolean default false, p_color text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only the admin can create accounts'; end if;
  return public._create_user(p_username, p_password, p_display_name, p_is_admin, p_color);
end $$;

create or replace function public.admin_update_user(
  p_user_id uuid, p_username text, p_display_name text, p_is_admin boolean, p_active boolean, p_color text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_username text := lower(trim(p_username));
  v_email    text;
begin
  if not public.is_admin() then raise exception 'Only the admin can edit accounts'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then raise exception 'User not found'; end if;
  perform public._check_username(v_username);
  if exists (select 1 from public.profiles where username = v_username and id <> p_user_id) then
    raise exception 'Username "%" is already taken', v_username;
  end if;
  if (not p_is_admin or not p_active)
     and not exists (select 1 from public.profiles where id <> p_user_id and is_admin and active) then
    raise exception 'There must always be at least one active admin';
  end if;

  v_email := public._email_for(v_username);
  update auth.users
     set email = v_email,
         raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('username', v_username),
         banned_until = case when p_active then null else now() + interval '100 years' end,
         updated_at = now()
   where id = p_user_id;
  update auth.identities
     set identity_data = identity_data || jsonb_build_object('email', v_email), updated_at = now()
   where user_id = p_user_id and provider = 'email';
  update public.profiles
     set username = v_username,
         display_name = coalesce(nullif(trim(p_display_name), ''), v_username),
         is_admin = p_is_admin,
         active = p_active,
         color = coalesce(nullif(p_color, ''), color)
   where id = p_user_id;

  if not p_active then
    delete from auth.sessions where user_id = p_user_id;   -- signs them out everywhere
  end if;
end $$;

create or replace function public.admin_set_password(p_user_id uuid, p_password text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only the admin can set other people''s passwords'; end if;
  perform public._check_password(p_password);
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
   where id = p_user_id;
  if not found then raise exception 'User not found'; end if;
end $$;

create or replace function public.admin_delete_user(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only the admin can delete accounts'; end if;
  if p_user_id = auth.uid() then raise exception 'You cannot delete your own account'; end if;
  begin
    delete from auth.users where id = p_user_id;
  exception when foreign_key_violation or restrict_violation then
    raise exception 'This person already has transactions or recurring items – disable the account instead';
  end;
end $$;

-- Any user: change own password (needs the current one).
create or replace function public.change_my_password(p_current text, p_new text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not exists (select 1 from auth.users
                  where id = auth.uid()
                    and encrypted_password = extensions.crypt(p_current, encrypted_password)) then
    raise exception 'Current password is incorrect';
  end if;
  perform public._check_password(p_new);
  update auth.users
     set encrypted_password = extensions.crypt(p_new, extensions.gen_salt('bf')), updated_at = now()
   where id = auth.uid();
end $$;

-- ---------------------------------------------------------------------
--  Recurring items: the app calls this on start-up. It creates every
--  transaction that is due (day reached) and not yet created. Each month is
--  posted exactly once, even if the posted transaction is later deleted.
-- ---------------------------------------------------------------------

create or replace function public.apply_recurring(p_today date default current_date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r          public.recurring;
  v_today    date := p_today;
  v_month    date;
  v_last_day integer;
  v_date     date;
  v_count    integer := 0;
begin
  if not public.is_member() then raise exception 'Not allowed'; end if;
  -- the client sends its local date; don't trust it beyond normal timezone skew
  if v_today is null or abs(v_today - current_date) > 1 then v_today := current_date; end if;

  for r in select * from public.recurring where active order by created_at for update loop
    v_month := greatest(coalesce((r.posted_through + interval '1 month')::date, r.start_month), r.start_month);
    while v_month <= date_trunc('month', v_today)::date
          and (r.end_month is null or v_month <= r.end_month) loop
      v_last_day := extract(day from (v_month + interval '1 month' - interval '1 day'))::integer;
      v_date := v_month + (least(r.day_of_month, v_last_day) - 1);
      exit when v_date > v_today;

      insert into public.transactions (kind, amount_cents, category_id, person_id, date, note, recurring_id, created_by)
      values (r.kind, r.amount_cents, r.category_id, r.person_id, v_date, r.name, r.id, r.created_by);
      update public.recurring set posted_through = v_month where id = r.id;

      v_count := v_count + 1;
      v_month := (v_month + interval '1 month')::date;
    end loop;
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------
--  Privileges
-- ---------------------------------------------------------------------

revoke all on public.profiles, public.categories, public.category_limits, public.recurring, public.transactions from anon;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.categories, public.category_limits, public.recurring, public.transactions to authenticated;

revoke execute on function public._create_user(text, text, text, boolean, text) from public, anon, authenticated;
revoke execute on function public._email_for(text) from public, anon, authenticated;
revoke execute on function public._check_username(text) from public, anon, authenticated;
revoke execute on function public._check_password(text) from public, anon, authenticated;

revoke execute on function public.is_member() from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.admin_create_user(text, text, text, boolean, text) from public, anon;
revoke execute on function public.admin_update_user(uuid, text, text, boolean, boolean, text) from public, anon;
revoke execute on function public.admin_set_password(uuid, text) from public, anon;
revoke execute on function public.admin_delete_user(uuid) from public, anon;
revoke execute on function public.change_my_password(text, text) from public, anon;
revoke execute on function public.apply_recurring(date) from public, anon;

grant execute on function public.is_member() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_create_user(text, text, text, boolean, text) to authenticated;
grant execute on function public.admin_update_user(uuid, text, text, boolean, boolean, text) to authenticated;
grant execute on function public.admin_set_password(uuid, text) to authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;
grant execute on function public.change_my_password(text, text) to authenticated;
grant execute on function public.apply_recurring(date) to authenticated;

-- ---------------------------------------------------------------------
--  Realtime: push every change to all open apps instantly
-- ---------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['profiles', 'categories', 'category_limits', 'recurring', 'transactions'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
--  Seed data
-- ---------------------------------------------------------------------

insert into public.categories (name, emoji, color, sort_order, is_system)
select v.name, v.emoji, v.color, v.sort_order, v.is_system
from (values
  ('Groceries',            '🛒', '#22c55e',  10, false),
  ('Restaurants & Coffee', '☕', '#f97316',  20, false),
  ('Transport & Fuel',     '⛽', '#0ea5e9',  30, false),
  ('Rent',                 '🏠', '#8b5cf6',  40, false),
  ('Loan',                 '🏦', '#a855f7',  45, false),
  ('Bills & Utilities',    '💡', '#eab308',  50, false),
  ('Health & Pharmacy',    '💊', '#ef4444',  60, false),
  ('Clothes',              '👕', '#ec4899',  70, false),
  ('Entertainment',        '🎬', '#6366f1',  80, false),
  ('Gifts',                '🎁', '#f43f5e',  90, false),
  ('Travel',               '✈️', '#14b8a6', 100, false),
  ('Household',            '🧹', '#84cc16', 110, false),
  ('Other',                '📦', '#64748b', 999, true)
) as v(name, emoji, color, sort_order, is_system)
where not exists (select 1 from public.categories);

-- First admin account: david / admin  (change the password in the app!)
select public._create_user('david', 'admin', 'David', true, '#3b82f6')
where not exists (select 1 from public.profiles);
