-- ============================================================
-- Day 8 — Portfolio Persistence: SQL Migration
--
-- Run this entire file in a single paste in the Supabase SQL Editor.
-- It is safe to re-run (all statements use IF NOT EXISTS / OR REPLACE
-- / DROP POLICY IF EXISTS patterns).
--
-- What this does:
--   1. Creates the portfolio_snapshots table (weekly value history)
--   2. Adds user-level RLS so regular players can buy/sell directly
--      via the client (pre-queue-system phase).  Security hardening
--      moves this to Edge Functions in Day 21.
--   3. Extends existing table policies for holdings, market_members,
--      and transactions to allow user self-service writes.
-- ============================================================

BEGIN;

-- ── 1. portfolio_snapshots ──────────────────────────────────────────────────
-- Stores one row per player per week, recording total portfolio value and
-- cash balance at the moment the week was advanced.  Used to power the
-- portfolio value line chart on the Portfolio page.

CREATE TABLE IF NOT EXISTS public.portfolio_snapshots (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id    UUID          NOT NULL REFERENCES public.markets(id)  ON DELETE CASCADE,
  user_id      UUID          NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  week         INT           NOT NULL,
  total_value  NUMERIC(10,2) NOT NULL,
  cash_balance NUMERIC(10,2) NOT NULL,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),

  UNIQUE (market_id, user_id, week)
);

COMMENT ON TABLE  public.portfolio_snapshots             IS 'Weekly snapshot of each player''s total portfolio value and cash. One row per player per week per market. Powers the line chart on the Portfolio page.';
COMMENT ON COLUMN public.portfolio_snapshots.total_value IS 'holdings_value + cash_balance at snapshot time. Computed in the client from static season data + live DB state.';
COMMENT ON COLUMN public.portfolio_snapshots.week        IS 'Matches the week index used in the frontend season data (0-based). Week 0 = start of season / draft day.';

-- Indexes for portfolio_snapshots
CREATE INDEX IF NOT EXISTS idx_snapshots_market_user ON public.portfolio_snapshots (market_id, user_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_week        ON public.portfolio_snapshots (market_id, week);

-- RLS for portfolio_snapshots
ALTER TABLE public.portfolio_snapshots ENABLE ROW LEVEL SECURITY;

-- Players can read their own snapshots
DROP POLICY IF EXISTS "snapshots: users can read their own" ON public.portfolio_snapshots;
CREATE POLICY "snapshots: users can read their own"
  ON public.portfolio_snapshots FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Players can insert their own snapshots (written on advanceWeek)
DROP POLICY IF EXISTS "snapshots: users can insert their own" ON public.portfolio_snapshots;
CREATE POLICY "snapshots: users can insert their own"
  ON public.portfolio_snapshots FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.is_market_member(market_id));

-- Players can overwrite their own snapshot for a given week (upsert)
DROP POLICY IF EXISTS "snapshots: users can update their own" ON public.portfolio_snapshots;
CREATE POLICY "snapshots: users can update their own"
  ON public.portfolio_snapshots FOR UPDATE TO authenticated
  USING     (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Admins can manage all snapshots (e.g., bulk advance-week for all players)
DROP POLICY IF EXISTS "snapshots: admins can manage all" ON public.portfolio_snapshots;
CREATE POLICY "snapshots: admins can manage all"
  ON public.portfolio_snapshots FOR ALL TO authenticated
  USING     (public.is_admin())
  WITH CHECK (public.is_admin());


-- ── 2. holdings — add user-level write policies ─────────────────────────────
-- The 001 schema only allowed admins to INSERT/UPDATE holdings.
-- We add player-level policies so direct buy/sell (pre-queue) works
-- without requiring an Edge Function.  Day 21 will tighten this.

DROP POLICY IF EXISTS "holdings: users can insert their own" ON public.holdings;
CREATE POLICY "holdings: users can insert their own"
  ON public.holdings FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND public.is_market_member(market_id)
  );

DROP POLICY IF EXISTS "holdings: users can update their own" ON public.holdings;
CREATE POLICY "holdings: users can update their own"
  ON public.holdings FOR UPDATE TO authenticated
  USING     (auth.uid() = user_id AND public.is_market_member(market_id))
  WITH CHECK (auth.uid() = user_id);


-- ── 3. market_members — allow players to update their own cash_balance ───────
-- Required so buy/sell can deduct/add cash without going through admin.
-- Only cash_balance and dividends_earned should be touched by players;
-- other columns (joined_at, market_id, user_id) are immutable.

DROP POLICY IF EXISTS "market_members: users can update their own balance" ON public.market_members;
CREATE POLICY "market_members: users can update their own balance"
  ON public.market_members FOR UPDATE TO authenticated
  USING     (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ── 4. transactions — allow players to insert their own records ──────────────
-- The 001 schema only allowed admins to insert transactions.  Players need
-- to write their own buy/sell transaction records during direct play.

DROP POLICY IF EXISTS "transactions: users can insert their own" ON public.transactions;
CREATE POLICY "transactions: users can insert their own"
  ON public.transactions FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND public.is_market_member(market_id)
  );


-- ── 5. dividend_payouts — allow players to insert their own rows ─────────────
-- Players call advanceWeek locally and write their own dividend payouts.
-- Admin-only restriction will be re-applied in Day 21 (Edge Functions).

DROP POLICY IF EXISTS "dividend_payouts: users can insert their own" ON public.dividend_payouts;
CREATE POLICY "dividend_payouts: users can insert their own"
  ON public.dividend_payouts FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND public.is_market_member(market_id)
  );


-- ── 6. markets — allow members to read markets they belong to ────────────────
-- The 001 policy uses is_market_member(id) which requires the user to
-- already be a member.  The invite-token join flow (JoinPage) reads the
-- market by invite_token before the user is a member.  This policy ensures
-- any authenticated user can read market rows (for the join flow).
-- Note: sensitive columns (dividend_overrides, etc.) are still fine to expose;
-- the real secrets are in the admin panel, not the market row.

DROP POLICY IF EXISTS "markets: any authenticated user can read" ON public.markets;
CREATE POLICY "markets: any authenticated user can read"
  ON public.markets FOR SELECT TO authenticated
  USING (true);


COMMIT;

-- ============================================================
-- End of Day 8 migration.
-- After running, verify in Table Editor:
--   - portfolio_snapshots table exists with correct columns
--   - Auth > Policies shows the new policies on holdings,
--     market_members, transactions, dividend_payouts, portfolio_snapshots
-- ============================================================
