-- ============================================================
-- Day 12 — Queue Validation: SQL Migration
--
-- Run in the Supabase SQL Editor after day11_queue.sql.
-- Safe to re-run (CREATE OR REPLACE / ALTER … IF NOT EXISTS).
--
-- What this does:
--   1. Adds price_per_share to queue_requests so the server can
--      compute how much cash a user has reserved in pending buys.
--      Share prices are computed client-side from season data, so
--      the client sends the price at submission time.
--   2. Creates submit_queue_request_validated() — a SECURITY DEFINER
--      PostgreSQL function that validates and inserts atomically.
--      Clients call it via supabase.rpc() instead of a direct INSERT.
--
-- Validation rules enforced server-side:
--   Both actions:
--     • Must be authenticated and a member of the market
--     • Must have fewer than 10 pending requests this week
--   Buy:
--     • cash_balance − Σ(pending buy prices this week) ≥ this price
--     • total_shares − Σ(all holdings for this team in market)
--                    − Σ(pending buys for this team in market) ≥ 1
--   Sell:
--     • User owns ≥ 1 share of this team in this market
-- ============================================================

BEGIN;

-- ── 1. Add price_per_share column to queue_requests ───────────────────────

ALTER TABLE public.queue_requests
  ADD COLUMN IF NOT EXISTS price_per_share NUMERIC(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.queue_requests.price_per_share IS
  'Share price at submission time (client-computed). Used to calculate reserved cash across pending buy requests.';


-- ── 2. submit_queue_request_validated() ──────────────────────────────────
-- SECURITY DEFINER: runs as the DB owner so it can read all holdings in
-- the market (needed for share-availability check) and insert despite RLS.
-- All other access is scoped to the calling user via auth.uid().

CREATE OR REPLACE FUNCTION public.submit_queue_request_validated(
  p_market_id      UUID,
  p_week           INT,
  p_action         TEXT,     -- 'buy' or 'sell'
  p_team_id        TEXT,     -- team name
  p_price_per_share NUMERIC, -- current share price (client-computed)
  p_total_shares   INT       -- total shares for this team (client-computed)
)
RETURNS public.queue_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id            UUID    := auth.uid();
  v_pending_count      INT;
  v_cash_balance       NUMERIC;
  v_reserved_cash      NUMERIC;
  v_owned_in_market    INT;
  v_pending_buys_team  INT;
  v_my_shares          INT;
  v_result             public.queue_requests;
BEGIN
  -- ── Auth & membership ──────────────────────────────────────────────────
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.is_market_member(p_market_id) THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;

  -- ── 10-request cap ─────────────────────────────────────────────────────
  SELECT COUNT(*) INTO v_pending_count
  FROM   public.queue_requests
  WHERE  market_id = p_market_id
    AND  user_id   = v_user_id
    AND  week      = p_week
    AND  status    = 'pending';

  IF v_pending_count >= 10 THEN
    RAISE EXCEPTION 'queue_full';
  END IF;

  -- ── Action-specific validation ─────────────────────────────────────────

  IF p_action = 'buy' THEN

    -- Cash: balance minus cash already reserved by pending buys this week
    SELECT cash_balance INTO v_cash_balance
    FROM   public.market_members
    WHERE  market_id = p_market_id AND user_id = v_user_id;

    SELECT COALESCE(SUM(price_per_share), 0) INTO v_reserved_cash
    FROM   public.queue_requests
    WHERE  market_id = p_market_id
      AND  user_id   = v_user_id
      AND  week      = p_week
      AND  action    = 'buy'
      AND  status    = 'pending';

    IF (v_cash_balance - v_reserved_cash) < p_price_per_share THEN
      RAISE EXCEPTION 'not_enough_cash';
    END IF;

    -- Shares: total minus all currently held minus pending buys in market
    SELECT COALESCE(SUM(shares), 0) INTO v_owned_in_market
    FROM   public.holdings
    WHERE  market_id = p_market_id AND team_id = p_team_id;

    SELECT COUNT(*) INTO v_pending_buys_team
    FROM   public.queue_requests
    WHERE  market_id = p_market_id
      AND  team_id   = p_team_id
      AND  week      = p_week
      AND  action    = 'buy'
      AND  status    = 'pending';

    IF (p_total_shares - v_owned_in_market - v_pending_buys_team) < 1 THEN
      RAISE EXCEPTION 'shares_unavailable';
    END IF;

  ELSIF p_action = 'sell' THEN

    SELECT COALESCE(shares, 0) INTO v_my_shares
    FROM   public.holdings
    WHERE  market_id = p_market_id
      AND  user_id   = v_user_id
      AND  team_id   = p_team_id;

    IF v_my_shares < 1 THEN
      RAISE EXCEPTION 'no_shares_to_sell';
    END IF;

  ELSE
    RAISE EXCEPTION 'invalid_action';
  END IF;

  -- ── Insert ─────────────────────────────────────────────────────────────
  INSERT INTO public.queue_requests
    (market_id, user_id, week, action, team_id, price_per_share, status)
  VALUES
    (p_market_id, v_user_id, p_week, p_action, p_team_id, p_price_per_share, 'pending')
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.submit_queue_request_validated IS
  'Validates and inserts a queue request atomically. Called via supabase.rpc() from the client. Rejects with a named exception code on any validation failure.';

COMMIT;

-- ============================================================
-- End of Day 12 migration.
-- After running, verify:
--   - queue_requests has price_per_share column
--   - Database > Functions shows submit_queue_request_validated
-- Test via SQL Editor:
--   SELECT * FROM submit_queue_request_validated(
--     '<market_id>', 1, 'buy', 'Duke', 4.50, 8
--   );
--   (Should fail with 'not_a_member' since auth.uid() is null in editor)
-- ============================================================
