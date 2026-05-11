-- ============================================================
-- Day 13 — Execute Queue: SQL Migration
--
-- Run in the Supabase SQL Editor after day12_queue_validation.sql.
-- Safe to re-run (CREATE OR REPLACE / ALTER … IF NOT EXISTS).
--
-- What this does:
--   1. Adds total_shares to queue_requests so the execute function
--      can check share availability without needing the client.
--   2. Replaces submit_queue_request_validated() to also store
--      total_shares in the new column.
--   3. Creates execute_queue(market_id, week) — the core game mechanic.
--      Algorithm:
--        a. Rank players by portfolio value ascending (worst first).
--           Uses latest portfolio_snapshot; falls back to cash_balance.
--        b. Rank each player's requests by submission time (oldest first).
--        c. Execute in round-robin order: all players' 1st request,
--           then all players' 2nd, etc.
--        d. Re-validate cash and shares at execution time.
--        e. On success: update holdings + cash_balance, log transaction,
--           mark executed.
--        f. On failure: mark failed with reason, no state change.
--        g. Write one execution_log row when done.
--      Idempotent: running twice processes 0 pending requests on 2nd run.
-- ============================================================

BEGIN;

-- ── 1. Add total_shares column ────────────────────────────────────────────

ALTER TABLE public.queue_requests
  ADD COLUMN IF NOT EXISTS total_shares INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.queue_requests.total_shares IS
  'Total shares available for this team (client-computed via calcShares(adjEM)). Stored at submission time for use by execute_queue.';


-- ── 2. Update submit_queue_request_validated to persist total_shares ──────

CREATE OR REPLACE FUNCTION public.submit_queue_request_validated(
  p_market_id       UUID,
  p_week            INT,
  p_action          TEXT,
  p_team_id         TEXT,
  p_price_per_share NUMERIC,
  p_total_shares    INT
)
RETURNS public.queue_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id           UUID    := auth.uid();
  v_pending_count     INT;
  v_cash_balance      NUMERIC;
  v_reserved_cash     NUMERIC;
  v_owned_in_market   INT;
  v_pending_buys_team INT;
  v_my_shares         INT;
  v_result            public.queue_requests;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public.is_market_member(p_market_id) THEN RAISE EXCEPTION 'not_a_member'; END IF;

  SELECT COUNT(*) INTO v_pending_count
  FROM   public.queue_requests
  WHERE  market_id = p_market_id AND user_id = v_user_id
    AND  week = p_week AND status = 'pending';
  IF v_pending_count >= 10 THEN RAISE EXCEPTION 'queue_full'; END IF;

  IF p_action = 'buy' THEN
    SELECT cash_balance INTO v_cash_balance
    FROM   public.market_members WHERE market_id = p_market_id AND user_id = v_user_id;

    SELECT COALESCE(SUM(price_per_share), 0) INTO v_reserved_cash
    FROM   public.queue_requests
    WHERE  market_id = p_market_id AND user_id = v_user_id
      AND  week = p_week AND action = 'buy' AND status = 'pending';

    IF (v_cash_balance - v_reserved_cash) < p_price_per_share THEN
      RAISE EXCEPTION 'not_enough_cash';
    END IF;

    SELECT COALESCE(SUM(shares), 0) INTO v_owned_in_market
    FROM   public.holdings WHERE market_id = p_market_id AND team_id = p_team_id;

    SELECT COUNT(*) INTO v_pending_buys_team
    FROM   public.queue_requests
    WHERE  market_id = p_market_id AND team_id = p_team_id
      AND  week = p_week AND action = 'buy' AND status = 'pending';

    IF (p_total_shares - v_owned_in_market - v_pending_buys_team) < 1 THEN
      RAISE EXCEPTION 'shares_unavailable';
    END IF;

  ELSIF p_action = 'sell' THEN
    SELECT COALESCE(shares, 0) INTO v_my_shares
    FROM   public.holdings
    WHERE  market_id = p_market_id AND user_id = v_user_id AND team_id = p_team_id;
    IF v_my_shares < 1 THEN RAISE EXCEPTION 'no_shares_to_sell'; END IF;

  ELSE
    RAISE EXCEPTION 'invalid_action';
  END IF;

  INSERT INTO public.queue_requests
    (market_id, user_id, week, action, team_id, price_per_share, total_shares, status)
  VALUES
    (p_market_id, v_user_id, p_week, p_action, p_team_id, p_price_per_share, p_total_shares, 'pending')
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;


-- ── 3. execute_queue ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.execute_queue(
  p_market_id UUID,
  p_week      INT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req          RECORD;
  v_cash_balance NUMERIC;
  v_owned_market INT;
  v_my_shares    INT;
  v_rows         INT;
  v_succeeded    INT := 0;
  v_failed       INT := 0;
  v_total        INT := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Round-robin execution order:
  --   Primary sort:   request_position ASC  (round 1 before round 2, etc.)
  --   Secondary sort: player_rank ASC       (lowest portfolio value executes first within each round)
  FOR v_req IN
    WITH portfolio_ranks AS (
      SELECT
        mm.user_id,
        ROW_NUMBER() OVER (
          ORDER BY COALESCE(
            (SELECT ps.total_value
             FROM   public.portfolio_snapshots ps
             WHERE  ps.market_id = mm.market_id AND ps.user_id = mm.user_id
             ORDER  BY ps.week DESC LIMIT 1),
            mm.cash_balance
          ) ASC
        ) AS player_rank
      FROM public.market_members mm
      WHERE mm.market_id = p_market_id
    ),
    request_ranks AS (
      SELECT
        qr.*,
        pr.player_rank,
        ROW_NUMBER() OVER (
          PARTITION BY qr.user_id
          ORDER BY qr.created_at ASC
        ) AS request_position
      FROM public.queue_requests qr
      JOIN portfolio_ranks pr ON pr.user_id = qr.user_id
      WHERE qr.market_id = p_market_id
        AND qr.week      = p_week
        AND qr.status    = 'pending'
    )
    SELECT * FROM request_ranks
    ORDER BY request_position ASC, player_rank ASC
  LOOP
    v_total := v_total + 1;

    -- ── BUY ───────────────────────────────────────────────────────────────
    IF v_req.action = 'buy' THEN

      -- Cash check: use current cash_balance (not reserved — at execute time
      -- each buy is processed sequentially, so cash reflects prior executions)
      SELECT cash_balance INTO v_cash_balance
      FROM   public.market_members
      WHERE  market_id = p_market_id AND user_id = v_req.user_id;

      IF v_cash_balance < v_req.price_per_share THEN
        UPDATE public.queue_requests
        SET    status = 'failed', failure_reason = 'not_enough_funds', executed_at = now()
        WHERE  id = v_req.id;
        v_failed := v_failed + 1;
        CONTINUE;
      END IF;

      -- Shares check: total shares minus everything held or executed in this run
      SELECT COALESCE(SUM(shares), 0) INTO v_owned_market
      FROM   public.holdings
      WHERE  market_id = p_market_id AND team_id = v_req.team_id;

      IF v_owned_market >= v_req.total_shares THEN
        UPDATE public.queue_requests
        SET    status = 'failed', failure_reason = 'shares_unavailable', executed_at = now()
        WHERE  id = v_req.id;
        v_failed := v_failed + 1;
        CONTINUE;
      END IF;

      -- Execute: update or insert holding
      UPDATE public.holdings
      SET    shares = shares + 1, updated_at = now()
      WHERE  market_id = p_market_id AND user_id = v_req.user_id AND team_id = v_req.team_id;
      GET DIAGNOSTICS v_rows = ROW_COUNT;

      IF v_rows = 0 THEN
        INSERT INTO public.holdings (market_id, user_id, team_id, shares)
        VALUES (p_market_id, v_req.user_id, v_req.team_id, 1);
      END IF;

      -- Deduct cash
      UPDATE public.market_members
      SET    cash_balance = cash_balance - v_req.price_per_share
      WHERE  market_id = p_market_id AND user_id = v_req.user_id;

      -- Transaction log
      INSERT INTO public.transactions
        (market_id, user_id, week, action, team_id, shares, price_per_share, total_value, source)
      VALUES
        (p_market_id, v_req.user_id, p_week, 'buy', v_req.team_id, 1,
         v_req.price_per_share, v_req.price_per_share, 'queue');

      UPDATE public.queue_requests
      SET    status = 'executed', executed_at = now()
      WHERE  id = v_req.id;

      v_succeeded := v_succeeded + 1;

    -- ── SELL ──────────────────────────────────────────────────────────────
    ELSIF v_req.action = 'sell' THEN

      SELECT COALESCE(shares, 0) INTO v_my_shares
      FROM   public.holdings
      WHERE  market_id = p_market_id AND user_id = v_req.user_id AND team_id = v_req.team_id;

      IF v_my_shares < 1 THEN
        UPDATE public.queue_requests
        SET    status = 'failed', failure_reason = 'no_shares_to_sell', executed_at = now()
        WHERE  id = v_req.id;
        v_failed := v_failed + 1;
        CONTINUE;
      END IF;

      -- Execute: decrement holding
      UPDATE public.holdings
      SET    shares = shares - 1, updated_at = now()
      WHERE  market_id = p_market_id AND user_id = v_req.user_id AND team_id = v_req.team_id;

      -- Add cash
      UPDATE public.market_members
      SET    cash_balance = cash_balance + v_req.price_per_share
      WHERE  market_id = p_market_id AND user_id = v_req.user_id;

      -- Transaction log
      INSERT INTO public.transactions
        (market_id, user_id, week, action, team_id, shares, price_per_share, total_value, source)
      VALUES
        (p_market_id, v_req.user_id, p_week, 'sell', v_req.team_id, 1,
         v_req.price_per_share, v_req.price_per_share, 'queue');

      UPDATE public.queue_requests
      SET    status = 'executed', executed_at = now()
      WHERE  id = v_req.id;

      v_succeeded := v_succeeded + 1;

    END IF;
  END LOOP;

  -- Write execution_log (skip if nothing to process — idempotent 2nd run)
  IF v_total > 0 THEN
    INSERT INTO public.execution_log
      (market_id, week, executed_at, total_requests, total_succeeded, total_failed)
    VALUES
      (p_market_id, p_week, now(), v_total, v_succeeded, v_failed);
  END IF;

  RETURN json_build_object(
    'total',     v_total,
    'succeeded', v_succeeded,
    'failed',    v_failed
  );
END;
$$;

COMMENT ON FUNCTION public.execute_queue IS
  'Admin-only. Executes all pending queue requests for a market week in round-robin order (lowest portfolio value first). Idempotent: re-running after all requests are processed returns {total:0}.';

COMMIT;

-- ============================================================
-- End of Day 13 migration.
-- After running, verify:
--   - queue_requests has total_shares column
--   - Database > Functions shows execute_queue and the updated
--     submit_queue_request_validated
-- To test idempotency from SQL Editor (will fail auth check, as expected):
--   SELECT execute_queue('<market_id>', 1);
--   -- Expected: ERROR: not_authorized  (no admin session in editor)
-- ============================================================
