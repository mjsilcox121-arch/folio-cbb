-- ============================================================
-- Day 11 — Queue Submission: SQL Migration
--
-- Run in the Supabase SQL Editor after day10_leaderboard.sql.
-- Safe to re-run (DROP … IF EXISTS throughout).
--
-- What this does:
--   1. Drops the Day 3 portfolio_id-based queue_requests table
--      (the portfolios table was never populated in practice — Day 8
--      moved cash tracking to market_members directly).
--   2. Creates a new queue_requests table using the market_id/user_id
--      pattern established in Day 8, with team_id as TEXT (team name).
--   3. Adds the is_market_member() helper function used in WITH CHECK
--      policies across Day 8+ tables.
--   4. Adds RLS policies: users read/insert their own requests; users
--      can cancel their own pending requests; admins manage all.
-- ============================================================

BEGIN;

-- ── 1. Drop old portfolio_id-based queue_requests ─────────────────────────
-- The Day 3 table was never used — portfolio rows were not created in the
-- join flow, so all portfolio_id FK references would have failed anyway.

DROP TABLE IF EXISTS public.queue_requests CASCADE;


-- ── 2. is_market_member helper ────────────────────────────────────────────
-- Used in WITH CHECK policies to verify the calling user belongs to a market.
-- SECURITY DEFINER so it can read market_members without recursing into RLS.

CREATE OR REPLACE FUNCTION public.is_market_member(p_market_id UUID)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.market_members
    WHERE market_id = p_market_id
      AND user_id   = auth.uid()
  );
$$;


-- ── 3. New queue_requests table ───────────────────────────────────────────
-- One row per buy/sell request per player per week.
-- team_id is TEXT (team name) — consistent with the holdings/transactions
-- tables written in Day 8, which also key teams by name not UUID.
-- Max 10 requests per player per week enforced in the application layer
-- (Day 12 will add a server-side Edge Function check).

CREATE TABLE public.queue_requests (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id      UUID        NOT NULL REFERENCES public.markets(id)   ON DELETE CASCADE,
  user_id        UUID        NOT NULL REFERENCES public.profiles(id)  ON DELETE CASCADE,
  week           INT         NOT NULL,
  action         TEXT        NOT NULL CHECK (action IN ('buy', 'sell')),
  team_id        TEXT        NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'executed', 'failed')),
  failure_reason TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  executed_at    TIMESTAMPTZ
);

COMMENT ON TABLE  public.queue_requests             IS 'Weekly buy/sell requests submitted by players. Executed in portfolio-value order by the Execute Queue admin action (Day 13).';
COMMENT ON COLUMN public.queue_requests.team_id     IS 'Team name (text key) — matches the team_id used in holdings and transactions tables.';
COMMENT ON COLUMN public.queue_requests.status      IS 'pending → executed | failed. Only the Execute Queue function changes status away from pending.';

-- Indexes
CREATE INDEX ON public.queue_requests (market_id, user_id, week);
CREATE INDEX ON public.queue_requests (market_id, week, status);


-- ── 4. RLS ────────────────────────────────────────────────────────────────

ALTER TABLE public.queue_requests ENABLE ROW LEVEL SECURITY;

-- Users read their own requests (all statuses — so they can see history)
DROP POLICY IF EXISTS "queue: users read own" ON public.queue_requests;
CREATE POLICY "queue: users read own"
  ON public.queue_requests FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Users submit requests for their own market
DROP POLICY IF EXISTS "queue: users insert own" ON public.queue_requests;
CREATE POLICY "queue: users insert own"
  ON public.queue_requests FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND public.is_market_member(market_id)
  );

-- Users cancel only their own pending requests (executed/failed are immutable)
DROP POLICY IF EXISTS "queue: users cancel own pending" ON public.queue_requests;
CREATE POLICY "queue: users cancel own pending"
  ON public.queue_requests FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND status = 'pending');

-- Admins manage everything (needed for Execute Queue in Day 13)
DROP POLICY IF EXISTS "queue: admins manage all" ON public.queue_requests;
CREATE POLICY "queue: admins manage all"
  ON public.queue_requests FOR ALL TO authenticated
  USING     (public.is_admin())
  WITH CHECK (public.is_admin());

COMMIT;

-- ============================================================
-- End of Day 11 migration.
-- After running, verify in Table Editor:
--   - queue_requests table exists with columns:
--       id, market_id, user_id, week, action, team_id,
--       status, failure_reason, created_at, executed_at
--   - Auth > Policies shows 4 policies on queue_requests
--   - public.is_market_member() function exists in Database > Functions
-- ============================================================
