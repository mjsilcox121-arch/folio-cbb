-- ============================================================
-- Day 20 — Admin Pending Queue View: SQL Migration
--
-- Run in the Supabase SQL Editor after day20_ticker_and_settings.sql.
-- Safe to re-run (CREATE OR REPLACE).
--
-- What this does:
--   Adds get_all_pending_queues(market_id) — admin-only RPC.
--   Returns every pending queue request for all players in the
--   market, joined with player names from profiles. The existing
--   RLS policy already lets users see only their own pending rows;
--   this SECURITY DEFINER function lets the admin bypass that for
--   operational oversight (seeing whose requests are queued before
--   running Execute Queue).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_all_pending_queues(p_market_id UUID)
RETURNS TABLE (
  id              UUID,
  user_id         UUID,
  player_name     TEXT,
  week            INT,
  action          TEXT,
  team_id         TEXT,
  price_per_share NUMERIC,
  created_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  SELECT
    qr.id,
    qr.user_id,
    COALESCE(p.username, 'Player')::TEXT AS player_name,
    qr.week,
    qr.action,
    qr.team_id,
    qr.price_per_share,
    qr.created_at
  FROM  public.queue_requests qr
  LEFT JOIN public.profiles p ON p.id = qr.user_id
  WHERE qr.market_id = p_market_id
    AND qr.status    = 'pending'
  ORDER BY p.username NULLS LAST, qr.created_at;
END;
$$;

COMMENT ON FUNCTION public.get_all_pending_queues IS
  'Admin-only. Returns all pending queue requests for every player in a market,
   joined with player names. SECURITY DEFINER bypasses the per-user RLS filter.
   Used by the admin panel to review queues before running Execute Queue.';

-- ============================================================
-- After running, verify in Database > Functions:
--   get_all_pending_queues exists with p_market_id parameter
-- Manual test:
--   1. Log in as admin, open AdminPage, expand an active market
--   2. "Pending queues" section shows all players' pending requests
--   3. Log in as a non-admin — calling this RPC should raise not_authorized
-- ============================================================
