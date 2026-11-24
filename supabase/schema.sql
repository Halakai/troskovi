-- =====================================================================
--  Troškovi – database schema for Supabase
--
--  Run the whole file in Supabase → SQL Editor (or `npm run db:apply`).
--  It is safe to re-run and it upgrades older versions in place: tables and
--  columns are added only if missing, constraints, functions and policies are
--  replaced, and seed data is only inserted where nothing exists yet.
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

-- Two separate lists: kind 'expense' and kind 'income'.
-- owner_id NULL = shared category, otherwise private to that person
-- (private categories are only offered in the owner's picker, but entries
-- that use them are visible to everyone).
-- parent_id set = subcategory of that (main) category. Only one level deep;
-- a subcategory is always in the same list and as shared/private as its main one.
create table if not exists public.categories (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(trim(name)) between 1 and 40),
  emoji          text not null default '📦',
  color          text not null default '#64748b',
  kind           text not null default 'expense',
  owner_id       uuid references public.profiles(id) on delete cascade,
  parent_id      uuid references public.categories(id) on delete cascade,
  default_shared boolean not null default false,   -- new entries in it start as "Shared" instead of "whoever adds it"
  is_system      boolean not null default false,   -- the undeletable "Other" / "Other income"
  sort_order     integer not null default 100,
  created_by     uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);

-- Monthly limit per category. A row applies from effective_from (1st of a
-- month) until the next row, so changing a limit never rewrites history.
-- amount_cents NULL = "no limit from this month on".
create table if not exists public.category_limits (
  category_id    uuid not null references public.categories(id) on delete cascade,
  effective_from date not null check (extract(day from effective_from) = 1),
  amount_cents   integer check (amount_cents is null or amount_cents >= 0),
  primary key (category_id, effective_from)
);

-- Savings accounts ("Emergency fund", "Vacation", …). owner_id NULL = shared.
-- Balance = initial_cents + all 'saving' transactions (deposits are positive,
-- withdrawals negative).
create table if not exists public.savings_accounts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(trim(name)) between 1 and 40),
  emoji         text not null default '🐷',
  color         text not null default '#14b8a6',
  owner_id      uuid references public.profiles(id) on delete restrict,
  goal_cents    integer check (goal_cents is null or goal_cents > 0),
  initial_cents integer not null default 0 check (initial_cents >= 0),   -- money already in it before tracking here
  archived      boolean not null default false,
  sort_order    integer not null default 100,
  created_by    uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- Templates for things that repeat every month (rent, loan, salary, savings…).
-- person_id NULL = shared.
create table if not exists public.recurring (
  id                 uuid primary key default gen_random_uuid(),
  kind               text not null default 'expense',
  name               text not null check (length(trim(name)) between 1 and 60),
  amount_cents       integer not null check (amount_cents > 0),
  category_id        uuid references public.categories(id) on delete restrict,
  savings_account_id uuid references public.savings_accounts(id) on delete cascade,
  person_id          uuid references public.profiles(id) on delete restrict,
  day_of_month       smallint not null check (day_of_month between 1 and 31),
  start_month        date not null default date_trunc('month', current_date)::date check (extract(day from start_month) = 1),
  end_month          date check (end_month is null or extract(day from end_month) = 1),
  posted_through     date,   -- last month (1st) for which a transaction was created
  active             boolean not null default true,
  created_by         uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at         timestamptz not null default now()
);

-- Expenses, incomes and savings movements. person_id NULL = shared (e.g. rent).
-- kind 'saving': money put into (positive) or taken out of (negative) a savings account.
create table if not exists public.transactions (
  id                 uuid primary key default gen_random_uuid(),
  kind               text not null default 'expense',
  amount_cents       integer not null,
  category_id        uuid references public.categories(id) on delete restrict,
  savings_account_id uuid references public.savings_accounts(id) on delete restrict,
  person_id          uuid references public.profiles(id) on delete restrict,
  date               date not null default current_date,
  note               text check (note is null or length(note) <= 200),
  recurring_id       uuid references public.recurring(id) on delete set null,
  created_by         uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists transactions_date_idx on public.transactions (date);

-- Settings for the whole household: always exactly one row.
-- carry_from: from this month on, whatever is left at the end of a month is
-- carried into the next one (NULL = every month starts from zero).
create table if not exists public.app_settings (
  id         boolean primary key default true check (id),
  carry_from date check (carry_from is null or extract(day from carry_from) = 1),
  updated_at timestamptz not null default now()
);

-- Where the everyday money really is: everyone's bank account, cash, …
-- (savings accounts are separate and not part of this). owner_id NULL = shared.
create table if not exists public.wallets (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) between 1 and 40),
  emoji      text not null default '🏦',
  owner_id   uuid references public.profiles(id) on delete cascade,
  archived   boolean not null default false,
  sort_order integer not null default 100,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Balance checks: what is really on the accounts, to compare with the app.
-- The difference itself is never stored. The app works it out from the balances
-- and the entries, so an entry added or corrected later also corrects the check.
create table if not exists public.balance_checks (
  id           uuid primary key default gen_random_uuid(),
  date         date not null,                        -- local day the balances are from
  whole_day    boolean not null default false,       -- true: from the end of that day; false: from checked_at
  checked_at   timestamptz not null default now(),
  real_cents   integer not null default 0,           -- all accounts together (the single ones only admins see)
  adjust_cents integer not null default 0,           -- accounts that joined (+) or dropped out (−) since the check before
  joined       boolean not null default false,       -- counted as one with the check after it
  created_by   uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at   timestamptz not null default now()
);
create unique index if not exists balance_checks_one_per_past_day on public.balance_checks (date) where whole_day;

create table if not exists public.balance_check_items (
  check_id     uuid not null references public.balance_checks(id) on delete cascade,
  wallet_id    uuid not null references public.wallets(id) on delete restrict,
  amount_cents integer not null,
  primary key (check_id, wallet_id)
);

-- ---------------------------------------------------------------------
--  Upgrades for databases created by an older version of this file
-- ---------------------------------------------------------------------

alter table public.categories   add column if not exists kind text not null default 'expense';
alter table public.categories   add column if not exists parent_id uuid references public.categories(id) on delete cascade;
alter table public.categories   add column if not exists default_shared boolean not null default false;
alter table public.recurring    add column if not exists savings_account_id uuid references public.savings_accounts(id) on delete cascade;
alter table public.transactions add column if not exists savings_account_id uuid references public.savings_accounts(id) on delete restrict;
-- balance_check_id: happened before that check, whatever its date or time says (e.g. it was found missing there)
-- write_off: the part of a check's difference nobody could explain
alter table public.transactions add column if not exists balance_check_id uuid references public.balance_checks(id) on delete set null;
alter table public.transactions add column if not exists write_off boolean not null default false;
create index if not exists transactions_balance_check_idx on public.transactions (balance_check_id) where balance_check_id is not null;
-- when the weekly balance check is due (weekday 0 = Sunday, NULL = never), and when it was last skipped
alter table public.app_settings add column if not exists check_weekday smallint default 0 check (check_weekday between 0 and 6);
alter table public.app_settings add column if not exists check_time text not null default '14:00' check (check_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
alter table public.app_settings add column if not exists check_skipped_at timestamptz;

-- ---------------------------------------------------------------------
--  Constraints that changed over time (dropped and re-added on every run)
-- ---------------------------------------------------------------------

alter table public.categories drop constraint if exists categories_kind_check;
alter table public.categories add constraint categories_kind_check check (kind in ('expense', 'income'));
drop index if exists public.categories_single_system;
create unique index if not exists categories_single_system_per_kind on public.categories (kind) where is_system;
create index if not exists categories_parent_idx on public.categories (parent_id) where parent_id is not null;

alter table public.recurring drop constraint if exists recurring_kind_check;
alter table public.recurring add constraint recurring_kind_check check (kind in ('expense', 'income', 'saving'));
alter table public.recurring drop constraint if exists recurring_savings_account_check;
alter table public.recurring add constraint recurring_savings_account_check
  check ((kind = 'saving') = (savings_account_id is not null));

alter table public.transactions drop constraint if exists transactions_kind_check;
alter table public.transactions add constraint transactions_kind_check check (kind in ('expense', 'income', 'saving'));
alter table public.transactions drop constraint if exists transactions_amount_cents_check;
alter table public.transactions add constraint transactions_amount_cents_check
  check (amount_cents > 0 or (kind = 'saving' and amount_cents <> 0));
alter table public.transactions drop constraint if exists transactions_savings_account_check;
alter table public.transactions add constraint transactions_savings_account_check
  check ((kind = 'saving') = (savings_account_id is not null));
create index if not exists transactions_savings_idx on public.transactions (savings_account_id) where savings_account_id is not null;

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

-- Keeps entries consistent: savings movements have an account and no category,
-- expenses and incomes only use categories from their own list.
create or replace function public.tg_entry_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind = 'saving' then
    new.category_id := null;
  else
    new.savings_account_id := null;
    if new.category_id is not null
       and not exists (select 1 from public.categories c where c.id = new.category_id and c.kind = new.kind) then
      raise exception 'That category belongs to the % list', case new.kind when 'income' then 'expense' else 'income' end;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists transactions_before_write on public.transactions;
create trigger transactions_before_write before insert or update on public.transactions
  for each row execute function public.tg_entry_before_write();
drop trigger if exists recurring_before_write on public.recurring;
create trigger recurring_before_write before insert or update on public.recurring
  for each row execute function public.tg_entry_before_write();

create or replace function public.tg_categories_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.is_system := old.is_system;
  new.kind := old.kind;   -- a category never moves between the expense and income lists
  if new.is_system then new.owner_id := null; end if;
  return new;
end $$;

drop trigger if exists categories_before_update on public.categories;
create trigger categories_before_update before update on public.categories
  for each row execute function public.tg_categories_before_update();

-- Subcategories: one level deep, same list as the main category, and shared or
-- private (and colored) exactly like it. (Runs after categories_before_update – triggers fire
-- in name order – so kind and is_system are already the stored ones.)
create or replace function public.tg_categories_before_write() returns trigger
language plpgsql set search_path = '' as $$
declare
  p public.categories;
begin
  if new.parent_id is null then return new; end if;
  select * into p from public.categories where id = new.parent_id;
  if not found then raise exception 'That main category does not exist'; end if;
  if new.parent_id = new.id then raise exception 'A category cannot be its own subcategory'; end if;
  if new.is_system then raise exception 'The "%" category cannot be a subcategory', new.name; end if;
  if p.parent_id is not null then raise exception 'A subcategory cannot have subcategories of its own'; end if;
  if p.kind <> new.kind then raise exception 'A subcategory must be in the same list as its main category'; end if;
  if tg_op = 'UPDATE' and exists (select 1 from public.categories c where c.parent_id = new.id) then
    raise exception '"%" has subcategories, so it cannot become a subcategory itself', new.name;
  end if;
  new.owner_id := p.owner_id;
  new.color := p.color;
  return new;
end $$;

drop trigger if exists categories_before_write on public.categories;
create trigger categories_before_write before insert or update on public.categories
  for each row execute function public.tg_categories_before_write();

-- A main category that becomes shared or private (or gets a new color) takes its subcategories along.
create or replace function public.tg_categories_after_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.owner_id is distinct from old.owner_id or new.color is distinct from old.color then
    update public.categories set owner_id = new.owner_id, color = new.color where parent_id = new.id;
  end if;
  return null;
end $$;

drop trigger if exists categories_after_update on public.categories;
create trigger categories_after_update after update on public.categories
  for each row execute function public.tg_categories_after_update();

-- Deleting a subcategory moves its entries up to the main category. Deleting a
-- main category moves its entries and those of its subcategories to "Other"
-- (or "Other income") and deletes the subcategories with it.
create or replace function public.tg_categories_before_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_target uuid;
begin
  if old.is_system then
    raise exception 'The "%" category cannot be deleted', old.name;
  end if;
  if old.parent_id is not null then
    v_target := old.parent_id;
  else
    select id into v_target from public.categories where is_system and kind = old.kind limit 1;
    update public.transactions set category_id = v_target
     where category_id in (select id from public.categories where parent_id = old.id);
    update public.recurring set category_id = v_target
     where category_id in (select id from public.categories where parent_id = old.id);
    delete from public.categories where parent_id = old.id;
  end if;
  update public.transactions set category_id = v_target where category_id = old.id;
  update public.recurring    set category_id = v_target where category_id = old.id;
  return old;
end $$;

drop trigger if exists categories_before_delete on public.categories;
create trigger categories_before_delete before delete on public.categories
  for each row execute function public.tg_categories_before_delete();

-- Everyone gets a bank account for the balance check.
create or replace function public.tg_profiles_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.wallets (name, owner_id, sort_order) values ('Bank account', new.id, 10);
  return null;
end $$;

drop trigger if exists profiles_after_insert on public.profiles;
create trigger profiles_after_insert after insert on public.profiles
  for each row execute function public.tg_profiles_after_insert();

-- ---------------------------------------------------------------------
--  Row level security
--    * everyone who has an active profile sees everything
--    * anyone can add; normal users edit only what they added
--    * only the admin deletes transactions
--    * only admins do balance checks and write-offs; what's on each single
--      account is for admins too, everyone else sees just the total
-- ---------------------------------------------------------------------

alter table public.profiles         enable row level security;
alter table public.categories       enable row level security;
alter table public.category_limits  enable row level security;
alter table public.savings_accounts enable row level security;
alter table public.recurring        enable row level security;
alter table public.transactions     enable row level security;
alter table public.app_settings     enable row level security;
alter table public.wallets             enable row level security;
alter table public.balance_checks      enable row level security;
alter table public.balance_check_items enable row level security;

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

-- savings accounts: like categories – shared ones are everyone's, personal ones the owner's
drop policy if exists savings_accounts_select on public.savings_accounts;
create policy savings_accounts_select on public.savings_accounts for select to authenticated
  using (public.is_member());

drop policy if exists savings_accounts_insert on public.savings_accounts;
create policy savings_accounts_insert on public.savings_accounts for insert to authenticated
  with check (public.is_member() and (owner_id is null or owner_id = auth.uid()));

drop policy if exists savings_accounts_update on public.savings_accounts;
create policy savings_accounts_update on public.savings_accounts for update to authenticated
  using (public.is_admin() or (public.is_member() and (owner_id is null or owner_id = auth.uid())))
  with check (public.is_admin() or (public.is_member() and (owner_id is null or owner_id = auth.uid())));

drop policy if exists savings_accounts_delete on public.savings_accounts;
create policy savings_accounts_delete on public.savings_accounts for delete to authenticated
  using (public.is_admin() or (public.is_member() and owner_id = auth.uid()));

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
  with check (public.is_member() and created_by = auth.uid() and (not write_off or public.is_admin()));

drop policy if exists transactions_update on public.transactions;
create policy transactions_update on public.transactions for update to authenticated
  using (public.is_admin() or (public.is_member() and created_by = auth.uid()))
  with check (public.is_admin() or (public.is_member() and created_by = auth.uid() and not write_off));

drop policy if exists transactions_delete on public.transactions;
create policy transactions_delete on public.transactions for delete to authenticated
  using (public.is_admin());

-- household settings: everyone reads and changes them (the single row is created below)
drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings for select to authenticated
  using (public.is_member());

drop policy if exists app_settings_update on public.app_settings;
create policy app_settings_update on public.app_settings for update to authenticated
  using (public.is_member()) with check (public.is_member());

-- balance check: accounts are set up by admins; checks are written only through the functions below
drop policy if exists wallets_select on public.wallets;
create policy wallets_select on public.wallets for select to authenticated
  using (public.is_member());

drop policy if exists wallets_write on public.wallets;
create policy wallets_write on public.wallets for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists balance_checks_select on public.balance_checks;
create policy balance_checks_select on public.balance_checks for select to authenticated
  using (public.is_member());

drop policy if exists balance_check_items_select on public.balance_check_items;
create policy balance_check_items_select on public.balance_check_items for select to authenticated
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
    raise exception 'This person already has entries, monthly items or savings accounts – disable the account instead';
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
--  Items that pay into an archived savings account are skipped.
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

  for r in
    select * from public.recurring rc
     where rc.active
       and not exists (select 1 from public.savings_accounts a where a.id = rc.savings_account_id and a.archived)
     order by rc.created_at
       for update
  loop
    v_month := greatest(coalesce((r.posted_through + interval '1 month')::date, r.start_month), r.start_month);
    while v_month <= date_trunc('month', v_today)::date
          and (r.end_month is null or v_month <= r.end_month) loop
      v_last_day := extract(day from (v_month + interval '1 month' - interval '1 day'))::integer;
      v_date := v_month + (least(r.day_of_month, v_last_day) - 1);
      exit when v_date > v_today;

      insert into public.transactions
        (kind, amount_cents, category_id, savings_account_id, person_id, date, note, recurring_id, created_by)
      values
        (r.kind, r.amount_cents, r.category_id, r.savings_account_id, r.person_id, v_date, r.name, r.id, r.created_by);
      update public.recurring set posted_through = v_month where id = r.id;

      v_count := v_count + 1;
      v_month := (v_month + interval '1 month')::date;
    end loop;
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------
--  Balance checks
-- ---------------------------------------------------------------------

-- Internal: works out adjust_cents of every check. An account that shows up for the first time
-- brings its balance with it, and one that is no longer listed takes its last balance along –
-- neither of them is money that went missing. Joined checks are skipped.
create or replace function public._recalc_checks() returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- the newest check has none after it to be joined with
  update public.balance_checks set joined = false
   where joined and id = (select id from public.balance_checks order by date desc, whole_day desc, checked_at desc, id desc limit 1);

  with chain as (
    select id, lag(id) over (order by date, whole_day, checked_at, id) as prev
      from public.balance_checks where not joined
  ), calc as (
    select c.id,
           case when c.prev is null then 0 else
             coalesce((select sum(i.amount_cents) from public.balance_check_items i
                        where i.check_id = c.id
                          and not exists (select 1 from public.balance_check_items p
                                           where p.check_id = c.prev and p.wallet_id = i.wallet_id)), 0)
           - coalesce((select sum(p.amount_cents) from public.balance_check_items p
                        where p.check_id = c.prev
                          and not exists (select 1 from public.balance_check_items i
                                           where i.check_id = c.id and i.wallet_id = p.wallet_id)), 0)
           end as adjust
      from chain c
  )
  update public.balance_checks b set adjust_cents = calc.adjust
    from calc where calc.id = b.id and b.adjust_cents <> calc.adjust;
end $$;

-- Saves a check (p_id NULL = new) with the balance of every account:
-- p_items = [{"wallet_id": …, "amount_cents": …}, …].
-- p_due: when the weekly check became due – if another admin has already done that one, theirs counts.
-- p_whole_day: balances from the end of a past day (typed in from a bank statement).
create or replace function public.save_balance_check(
  p_id uuid, p_date date, p_whole_day boolean, p_items jsonb, p_due timestamptz default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id   uuid := p_id;
  v_date date := p_date;
  v_by   text;
begin
  if not public.is_admin() then raise exception 'Only an admin can do the balance check'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Enter the balance of at least one account';
  end if;
  lock table public.balance_checks in share row exclusive mode;   -- two admins at the same moment

  if v_id is null then
    if p_whole_day then
      if v_date is null or v_date > current_date then raise exception 'Pick a day that is already over'; end if;
      if exists (select 1 from public.balance_checks where whole_day and date = v_date) then
        raise exception 'There is already a check for the end of that day';
      end if;
    else
      if p_due is not null then
        select p.display_name into v_by
          from public.balance_checks c join public.profiles p on p.id = c.created_by
         where not c.whole_day and c.checked_at >= p_due
         order by c.checked_at limit 1;
        if found then raise exception 'Already done – % filled it in', v_by; end if;
      end if;
      -- the client sends its local date; don't trust it beyond normal timezone skew
      if v_date is null or abs(v_date - current_date) > 1 then v_date := current_date; end if;
    end if;
    insert into public.balance_checks (date, whole_day) values (v_date, coalesce(p_whole_day, false)) returning id into v_id;
  else
    if not exists (select 1 from public.balance_checks where id = v_id) then
      raise exception 'This check no longer exists';
    end if;
    delete from public.balance_check_items where check_id = v_id;
  end if;

  insert into public.balance_check_items (check_id, wallet_id, amount_cents)
  select v_id, (x ->> 'wallet_id')::uuid, (x ->> 'amount_cents')::integer from jsonb_array_elements(p_items) x;
  update public.balance_checks
     set real_cents = (select sum(amount_cents) from public.balance_check_items where check_id = v_id)
   where id = v_id;
  perform public._recalc_checks();
  return v_id;
end $$;

-- Deletes a check and its write-offs. Entries found missing there stay and count by their date again.
create or replace function public.delete_balance_check(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only an admin can delete a balance check'; end if;
  delete from public.transactions where balance_check_id = p_id and write_off;
  delete from public.balance_checks where id = p_id;
  perform public._recalc_checks();
end $$;

-- Counts checks as one with the check after them (their differences cancelled out), or separates them again.
create or replace function public.join_balance_checks(p_ids uuid[], p_joined boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only an admin can do that'; end if;
  update public.balance_checks set joined = p_joined where id = any (p_ids);
  perform public._recalc_checks();
end $$;

-- ---------------------------------------------------------------------
--  Privileges
-- ---------------------------------------------------------------------

revoke all on public.profiles, public.categories, public.category_limits, public.savings_accounts,
              public.recurring, public.transactions, public.app_settings,
              public.wallets, public.balance_checks, public.balance_check_items from anon;
revoke all on public.balance_checks, public.balance_check_items from authenticated;   -- read-only, see above
grant select on public.balance_checks, public.balance_check_items to authenticated;
grant select on public.profiles to authenticated;
grant select, update on public.app_settings to authenticated;
grant select, insert, update, delete on public.categories, public.category_limits, public.savings_accounts,
                                        public.recurring, public.transactions, public.wallets to authenticated;

revoke execute on function public._create_user(text, text, text, boolean, text) from public, anon, authenticated;
revoke execute on function public._email_for(text) from public, anon, authenticated;
revoke execute on function public._check_username(text) from public, anon, authenticated;
revoke execute on function public._check_password(text) from public, anon, authenticated;
revoke execute on function public._recalc_checks() from public, anon, authenticated;

revoke execute on function public.is_member() from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.admin_create_user(text, text, text, boolean, text) from public, anon;
revoke execute on function public.admin_update_user(uuid, text, text, boolean, boolean, text) from public, anon;
revoke execute on function public.admin_set_password(uuid, text) from public, anon;
revoke execute on function public.admin_delete_user(uuid) from public, anon;
revoke execute on function public.change_my_password(text, text) from public, anon;
revoke execute on function public.apply_recurring(date) from public, anon;
revoke execute on function public.save_balance_check(uuid, date, boolean, jsonb, timestamptz) from public, anon;
revoke execute on function public.delete_balance_check(uuid) from public, anon;
revoke execute on function public.join_balance_checks(uuid[], boolean) from public, anon;

grant execute on function public.is_member() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_create_user(text, text, text, boolean, text) to authenticated;
grant execute on function public.admin_update_user(uuid, text, text, boolean, boolean, text) to authenticated;
grant execute on function public.admin_set_password(uuid, text) to authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;
grant execute on function public.change_my_password(text, text) to authenticated;
grant execute on function public.apply_recurring(date) to authenticated;
grant execute on function public.save_balance_check(uuid, date, boolean, jsonb, timestamptz) to authenticated;
grant execute on function public.delete_balance_check(uuid) to authenticated;
grant execute on function public.join_balance_checks(uuid[], boolean) to authenticated;

-- ---------------------------------------------------------------------
--  Realtime: push every change to all open apps instantly
-- ---------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['profiles', 'categories', 'category_limits', 'savings_accounts', 'recurring', 'transactions', 'app_settings',
                           'wallets', 'balance_checks', 'balance_check_items'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
--  Seed data
-- ---------------------------------------------------------------------

insert into public.categories (name, emoji, color, sort_order, is_system, kind)
select v.name, v.emoji, v.color, v.sort_order, v.is_system, 'expense'
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
where not exists (select 1 from public.categories where kind = 'expense');

insert into public.categories (name, emoji, color, sort_order, is_system, kind)
select v.name, v.emoji, v.color, v.sort_order, v.is_system, 'income'
from (values
  ('Salary',       '💼', '#22c55e',  10, false),
  ('Bonus',        '🎉', '#eab308',  20, false),
  ('Side income',  '💻', '#0ea5e9',  30, false),
  ('Gifts',        '🎁', '#f43f5e',  40, false),
  ('Refunds',      '↩️', '#14b8a6',  50, false),
  ('Other income', '💰', '#64748b', 999, true)
) as v(name, emoji, color, sort_order, is_system)
where not exists (select 1 from public.categories where kind = 'income');

-- New installs carry leftover money over from the month they start in.
insert into public.app_settings (id, carry_from)
values (true, date_trunc('month', current_date)::date)
on conflict (id) do nothing;

-- First admin account: david / admin  (change the password in the app!)
select public._create_user('david', 'admin', 'David', true, '#3b82f6')
where not exists (select 1 from public.profiles);

-- Accounts for the balance check: one per person plus shared cash. New people get theirs from the
-- trigger on profiles. (Nothing is added back once there are accounts or checks.)
insert into public.wallets (name, owner_id, sort_order)
select 'Bank account', p.id, 10 from public.profiles p
where p.active and not exists (select 1 from public.wallets);

insert into public.wallets (name, emoji, sort_order)
select 'Cash', '💵', 90
where not exists (select 1 from public.wallets where owner_id is null)
  and not exists (select 1 from public.balance_checks);
