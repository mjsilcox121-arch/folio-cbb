-- =============================================================
-- FOLIO — Day 3: Database Schema Migration
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- Safe to re-run: uses CREATE IF NOT EXISTS and ON CONFLICT DO NOTHING
-- =============================================================

-- Enable UUID generation
create extension if not exists "uuid-ossp";


-- =============================================================
-- SECTION 1: TABLES
-- =============================================================

-- -------------------------------------------------------
-- USERS (extends Supabase Auth)
-- One row per authenticated user. Created automatically on signup via trigger.
-- -------------------------------------------------------
create table if not exists public.users (
  id          uuid        primary key references auth.users(id) on delete cascade,
  email       text        not null,
  is_admin    boolean     not null default false,
  created_at  timestamptz not null default now()
);

-- Auto-create a users row when someone signs up via Supabase Auth
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, is_admin)
  values (new.id, new.email, false)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- -------------------------------------------------------
-- MARKETS
-- A market is one game session (e.g. "2025–26 Season Beta").
-- status flow: waiting → draft → active → complete
-- -------------------------------------------------------
create table if not exists public.markets (
  id          uuid        primary key default uuid_generate_v4(),
  name        text        not null,
  created_by  uuid        not null references public.users(id),
  max_players int         not null check (max_players between 6 and 15),
  status      text        not null default 'waiting'
                          check (status in ('waiting', 'draft', 'active', 'complete')),
  created_at  timestamptz not null default now()
);


-- -------------------------------------------------------
-- MARKET MEMBERS
-- Tracks which users belong to which market.
-- -------------------------------------------------------
create table if not exists public.market_members (
  market_id   uuid        not null references public.markets(id) on delete cascade,
  user_id     uuid        not null references public.users(id)   on delete cascade,
  joined_at   timestamptz not null default now(),
  primary key (market_id, user_id)
);


-- -------------------------------------------------------
-- TEAMS
-- One row per D-I team per season. Populated by the Torvik adapter.
-- efficiency_rating: source-agnostic replacement for the old adj_em column.
-- data_source: records which provider last wrote this row ("torvik", "net", etc.)
-- -------------------------------------------------------
create table if not exists public.teams (
  id                uuid        primary key default uuid_generate_v4(),
  name              text        not null,
  conference        text,
  efficiency_rating numeric,
  record            text,
  shares_total      int         not null default 10,
  share_price       numeric,
  data_source       text,
  season            text,
  updated_at        timestamptz not null default now(),
  unique (name, season)  -- required by the seed-teams.js upsert script
);


-- -------------------------------------------------------
-- SETTINGS
-- Admin-editable key/value config. Seeded with defaults below.
-- -------------------------------------------------------
create table if not exists public.settings (
  key        text        primary key,
  value      text        not null,
  updated_at timestamptz not null default now()
);

-- Default seed — identifies which data providers are active
insert into public.settings (key, value) values
  ('efficiency_source', 'torvik'),
  ('schedule_source',   'sportsref'),
  ('results_source',    'sportsref')
on conflict (key) do nothing;


-- -------------------------------------------------------
-- PORTFOLIOS
-- One row per player per market. cash starts at 100.00.
-- locked = true during draft day and week 1 before queue opens.
-- -------------------------------------------------------
create table if not exists public.portfolios (
  id          uuid        primary key default uuid_generate_v4(),
  market_id   uuid        not null references public.markets(id) on delete cascade,
  user_id     uuid        not null references public.users(id)   on delete cascade,
  cash        numeric     not null default 100.00,
  locked      boolean     not null default false,
  updated_at  timestamptz not null default now(),
  unique (market_id, user_id)
);


-- -------------------------------------------------------
-- PORTFOLIO HOLDINGS
-- Tracks how many shares of each team a portfolio owns.
-- -------------------------------------------------------
create table if not exists public.portfolio_holdings (
  portfolio_id  uuid  not null references public.portfolios(id) on delete cascade,
  team_id       uuid  not null references public.teams(id)      on delete cascade,
  shares_owned  int   not null default 0 check (shares_owned >= 0),
  primary key (portfolio_id, team_id)
);


-- -------------------------------------------------------
-- QUEUE REQUESTS
-- Player-submitted buy/sell requests for the current week.
-- Each request = 1 share (buy or sell). Max 10 per week per portfolio.
-- Status: pending → executed | failed
-- -------------------------------------------------------
create table if not exists public.queue_requests (
  id             uuid        primary key default uuid_generate_v4(),
  portfolio_id   uuid        not null references public.portfolios(id) on delete cascade,
  week           int         not null,
  action         text        not null check (action in ('buy', 'sell')),
  team_id        uuid        not null references public.teams(id),
  status         text        not null default 'pending'
                             check (status in ('pending', 'executed', 'failed')),
  failure_reason text,
  created_at     timestamptz not null default now(),
  executed_at    timestamptz
);


-- -------------------------------------------------------
-- EXECUTION LOG
-- One row written after each "Execute Queue" run.
-- -------------------------------------------------------
create table if not exists public.execution_log (
  id               uuid        primary key default uuid_generate_v4(),
  market_id        uuid        not null references public.markets(id) on delete cascade,
  week             int         not null,
  executed_at      timestamptz not null default now(),
  total_requests   int         not null default 0,
  total_succeeded  int         not null default 0,
  total_failed     int         not null default 0
);


-- -------------------------------------------------------
-- DRAFT STATE
-- One row per market during the draft phase.
-- draft_order: JSON array of user_ids defining turn sequence.
-- -------------------------------------------------------
create table if not exists public.draft_state (
  market_id             uuid    primary key references public.markets(id) on delete cascade,
  current_turn_user_id  uuid    references public.users(id),
  draft_order           jsonb   not null default '[]',
  status                text    not null default 'waiting'
                                check (status in ('waiting', 'active', 'complete'))
);


-- =============================================================
-- SECTION 2: HELPER FUNCTION (admin check — bypasses RLS)
-- =============================================================
-- Defined here (after users table) so the function body can reference public.users.
-- Runs as the DB owner (security definer) to avoid RLS recursion.

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select is_admin from public.users where id = auth.uid()),
    false
  );
$$;


-- =============================================================
-- SECTION 3: ROW LEVEL SECURITY
-- =============================================================
-- Policy summary:
--   • Users read/write only their own data
--   • Users can see market-level data for markets they belong to
--   • Admins (is_admin = true) can do anything to any table
--   • Server-side Edge Functions use the service key, which bypasses RLS entirely
-- =============================================================

alter table public.users              enable row level security;
alter table public.markets            enable row level security;
alter table public.market_members     enable row level security;
alter table public.teams              enable row level security;
alter table public.settings           enable row level security;
alter table public.portfolios         enable row level security;
alter table public.portfolio_holdings enable row level security;
alter table public.queue_requests     enable row level security;
alter table public.execution_log      enable row level security;
alter table public.draft_state        enable row level security;


-- -------------------------------------------------------
-- USERS policies
-- -------------------------------------------------------
drop policy if exists "Users: view own profile"    on public.users;
drop policy if exists "Users: update own profile"  on public.users;
drop policy if exists "Admins: manage users"       on public.users;

create policy "Users: view own profile"
  on public.users for select
  using (auth.uid() = id);

create policy "Users: update own profile"
  on public.users for update
  using (auth.uid() = id);

create policy "Admins: manage users"
  on public.users for all
  using (public.is_admin());


-- -------------------------------------------------------
-- MARKETS policies
-- -------------------------------------------------------
drop policy if exists "Users: view own markets" on public.markets;
drop policy if exists "Admins: manage markets"  on public.markets;

create policy "Users: view own markets"
  on public.markets for select
  using (
    exists (
      select 1 from public.market_members
      where market_id = public.markets.id
        and user_id   = auth.uid()
    )
  );

create policy "Admins: manage markets"
  on public.markets for all
  using (public.is_admin());


-- -------------------------------------------------------
-- MARKET MEMBERS policies
-- -------------------------------------------------------
drop policy if exists "Users: view members of own market" on public.market_members;
drop policy if exists "Admins: manage market members"     on public.market_members;

create policy "Users: view members of own market"
  on public.market_members for select
  using (
    exists (
      select 1 from public.market_members mm
      where mm.market_id = public.market_members.market_id
        and mm.user_id   = auth.uid()
    )
  );

create policy "Admins: manage market members"
  on public.market_members for all
  using (public.is_admin());


-- -------------------------------------------------------
-- TEAMS policies
-- All authenticated users can read; only admins (or service key) write.
-- -------------------------------------------------------
drop policy if exists "Authenticated: view teams" on public.teams;
drop policy if exists "Admins: manage teams"      on public.teams;

create policy "Authenticated: view teams"
  on public.teams for select
  to authenticated
  using (true);

create policy "Admins: manage teams"
  on public.teams for all
  using (public.is_admin());


-- -------------------------------------------------------
-- SETTINGS policies
-- All authenticated users can read; only admins write.
-- -------------------------------------------------------
drop policy if exists "Authenticated: view settings" on public.settings;
drop policy if exists "Admins: manage settings"      on public.settings;

create policy "Authenticated: view settings"
  on public.settings for select
  to authenticated
  using (true);

create policy "Admins: manage settings"
  on public.settings for all
  using (public.is_admin());


-- -------------------------------------------------------
-- PORTFOLIOS policies
-- Users can read their own portfolio; only server-side (service key) writes.
-- -------------------------------------------------------
drop policy if exists "Users: view own portfolio"  on public.portfolios;
drop policy if exists "Admins: manage portfolios"  on public.portfolios;

create policy "Users: view own portfolio"
  on public.portfolios for select
  using (user_id = auth.uid());

create policy "Admins: manage portfolios"
  on public.portfolios for all
  using (public.is_admin());


-- -------------------------------------------------------
-- PORTFOLIO HOLDINGS policies
-- Users can read their own holdings; only server-side writes.
-- -------------------------------------------------------
drop policy if exists "Users: view own holdings"  on public.portfolio_holdings;
drop policy if exists "Admins: manage holdings"   on public.portfolio_holdings;

create policy "Users: view own holdings"
  on public.portfolio_holdings for select
  using (
    exists (
      select 1 from public.portfolios
      where id      = portfolio_id
        and user_id = auth.uid()
    )
  );

create policy "Admins: manage holdings"
  on public.portfolio_holdings for all
  using (public.is_admin());


-- -------------------------------------------------------
-- QUEUE REQUESTS policies
-- Users can read, insert, and cancel (delete) their own pending requests only.
-- Executed/failed requests are read-only; only server-side can write those.
-- -------------------------------------------------------
drop policy if exists "Users: view own queue"           on public.queue_requests;
drop policy if exists "Users: submit queue request"     on public.queue_requests;
drop policy if exists "Users: cancel pending request"   on public.queue_requests;
drop policy if exists "Admins: manage queue requests"   on public.queue_requests;

create policy "Users: view own queue"
  on public.queue_requests for select
  using (
    exists (
      select 1 from public.portfolios
      where id      = portfolio_id
        and user_id = auth.uid()
    )
  );

create policy "Users: submit queue request"
  on public.queue_requests for insert
  with check (
    exists (
      select 1 from public.portfolios
      where id      = portfolio_id
        and user_id = auth.uid()
    )
  );

create policy "Users: cancel pending request"
  on public.queue_requests for delete
  using (
    status = 'pending'
    and exists (
      select 1 from public.portfolios
      where id      = portfolio_id
        and user_id = auth.uid()
    )
  );

create policy "Admins: manage queue requests"
  on public.queue_requests for all
  using (public.is_admin());


-- -------------------------------------------------------
-- EXECUTION LOG policies
-- Users can read the log for their market; only server-side writes.
-- -------------------------------------------------------
drop policy if exists "Users: view execution log" on public.execution_log;
drop policy if exists "Admins: manage execution log" on public.execution_log;

create policy "Users: view execution log"
  on public.execution_log for select
  using (
    exists (
      select 1 from public.market_members
      where market_id = public.execution_log.market_id
        and user_id   = auth.uid()
    )
  );

create policy "Admins: manage execution log"
  on public.execution_log for all
  using (public.is_admin());


-- -------------------------------------------------------
-- DRAFT STATE policies
-- Users can read draft state for their market; only server-side writes.
-- -------------------------------------------------------
drop policy if exists "Users: view draft state"   on public.draft_state;
drop policy if exists "Admins: manage draft state" on public.draft_state;

create policy "Users: view draft state"
  on public.draft_state for select
  using (
    exists (
      select 1 from public.market_members
      where market_id = public.draft_state.market_id
        and user_id   = auth.uid()
    )
  );

create policy "Admins: manage draft state"
  on public.draft_state for all
  using (public.is_admin());


-- =============================================================
-- DONE
-- After running this script:
--   1. In Supabase Auth settings, enable Email/Password provider
--   2. Sign up with your account, then manually set is_admin = true:
--        UPDATE public.users SET is_admin = true WHERE email = 'YOUR_EMAIL';
--   3. Team seeding (Torvik adapter) is handled in Day 2 completion —
--      run the seeding script after the src/lib/providers/torvik.js
--      adapter is built.
-- =============================================================
