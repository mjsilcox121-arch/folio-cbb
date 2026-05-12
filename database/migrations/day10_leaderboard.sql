-- ============================================================
-- Day 10 — Leaderboard: SQL Migration
--
-- Run in the Supabase SQL Editor after day8_portfolio_migration.sql.
-- Safe to re-run (DROP POLICY IF EXISTS pattern throughout).
--
-- What this does:
--   1. Allows market members to read each other's cash_balance in
--      market_members (needed for leaderboard when no snapshots exist yet)
--   2. Allows market members to read each other's portfolio_snapshots
--      total_value (the leaderboard primary data source)
--
-- Security note:
--   Individual holdings, transactions, queue_requests, and dividend_payouts
--   remain private (user can only read their own rows — unchanged from Day 8).
--   The leaderboard only exposes aggregate totals, which matches the game
--   spec: "Other players' holdings are visible (just the portfolio value
--   total, not their individual positions)."
-- ============================================================

BEGIN;

-- ── 1. market_members — allow co-members to read portfolio totals ─────────
-- The Day 8 SELECT policy restricts reads to the user's own row.
-- We add a co-member policy so all players in the same market can see
-- each other's cash_balance (used as the leaderboard fallback value before
-- any portfolio snapshots exist).

DROP POLICY IF EXISTS "market_members: co-members can read each other" ON public.market_members;
CREATE POLICY "market_members: co-members can read each other"
  ON public.market_members FOR SELECT TO authenticated
  USING (public.is_market_member(market_id));

-- ── 2. portfolio_snapshots — allow co-members to read leaderboard data ────
-- The Day 8 SELECT policy restricts reads to the snapshot owner's own rows.
-- We add a co-member policy so the leaderboard can fetch the latest snapshot
-- for all players in a market.

DROP POLICY IF EXISTS "snapshots: co-members can read leaderboard data" ON public.portfolio_snapshots;
CREATE POLICY "snapshots: co-members can read leaderboard data"
  ON public.portfolio_snapshots FOR SELECT TO authenticated
  USING (public.is_market_member(market_id));

COMMIT;

-- ============================================================
-- End of Day 10 migration.
-- After running, verify in Auth > Policies:
--   market_members: "co-members can read each other" policy exists
--   portfolio_snapshots: "co-members can read leaderboard data" policy exists
--
-- Test: log in as Player A and call getLeaderboard(marketId) — confirm
-- you can see Player B's total_value without seeing their individual holdings.
-- ============================================================
