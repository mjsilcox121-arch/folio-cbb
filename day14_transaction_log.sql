-- ============================================================
-- Day 14 — Transaction Log: SQL Migration
--
-- Run in the Supabase SQL Editor after day13_execute_queue.sql.
-- Safe to re-run (CREATE POLICY uses IF NOT EXISTS equivalent via
-- DROP + CREATE or by checking pg_policies).
--
-- What this does:
--   Adds one RLS SELECT policy to queue_requests so that all
--   members of a market can read executed and failed requests
--   from any player in that market.
--
--   The existing "users read own" policy stays — pending requests
--   remain private (only the owner sees them). This new policy
--   layers on top (RLS policies are OR'd for SELECT).
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS "queue_requests: co-members can read results" ON public.queue_requests;

CREATE POLICY "queue_requests: co-members can read results"
  ON public.queue_requests
  FOR SELECT
  USING (
    status IN ('executed', 'failed')
    AND public.is_market_member(market_id)
  );

COMMIT;

-- ============================================================
-- End of Day 14 migration.
-- After running, verify:
--   - Two accounts in the same market can both see the other's
--     executed/failed rows in queue_requests.
--   - Neither account can see the other's pending rows.
-- ============================================================
