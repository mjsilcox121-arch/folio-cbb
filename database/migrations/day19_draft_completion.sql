-- ============================================================
-- Day 19 — Draft Completion & Portfolio Lock: SQL Migration
--
-- Run in the Supabase SQL Editor after day15_draft_infrastructure.sql.
-- Safe to re-run (CREATE OR REPLACE / ALTER … IF NOT EXISTS).
--
-- What this does:
--   1. Adds is_locked BOOLEAN to market_members — true immediately
--      after the draft, false once the admin advances to Week 1.
--   2. Creates _finalize_draft(market_id) — internal helper called
--      by submit_draft_pick and lock_in_draft when the draft ends:
--        a. Sets is_locked = TRUE for all members in the market.
--        b. Snapshots week 0 portfolio values (pick costs + cash)
--           into portfolio_snapshots for every player.
--   3. Replaces submit_draft_pick and lock_in_draft with updated
--      versions that call _finalize_draft when all players are done.
--   4. Creates unlock_portfolios(market_id) — admin-only RPC.
--      Called by advanceMarketWeek when the admin advances to Week 1.
--   5. Updates submit_queue_request_validated to reject submissions
--      while is_locked = TRUE (portfolio_locked exception).
-- ============================================================

BEGIN;

-- ── 1. Add is_locked to market_members ───────────────────────────────────────

ALTER TABLE public.market_members
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.market_members.is_locked IS
  'TRUE immediately after draft completes; FALSE once admin advances to Week 1.
   Prevents queue submissions while portfolios are locked post-draft.';


-- ── 2. _finalize_draft — internal helper ─────────────────────────────────────
-- Called from within submit_draft_pick and lock_in_draft when v_all_locked.
-- SECURITY DEFINER so it can write to all rows regardless of who triggered it.

CREATE OR REPLACE FUNCTION public._finalize_draft(p_market_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Lock all portfolios in this market
  UPDATE public.market_members
  SET    is_locked = TRUE
  WHERE  market_id = p_market_id;

  -- Snapshot week 0 portfolio values for every player.
  -- Total value = cash remaining after draft + sum of draft pick prices (1 share each).
  INSERT INTO public.portfolio_snapshots
    (market_id, user_id, week, total_value, cash_balance)
  SELECT
    p_market_id,
    mm.user_id,
    0,
    mm.cash_balance + COALESCE(
      (SELECT SUM(dp.price_per_share)
       FROM   public.draft_picks dp
       WHERE  dp.market_id = p_market_id
         AND  dp.user_id   = mm.user_id),
      0
    ),
    mm.cash_balance
  FROM public.market_members mm
  WHERE mm.market_id = p_market_id
  ON CONFLICT (market_id, user_id, week) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public._finalize_draft IS
  'Internal. Called when all draft players are locked in. Locks all portfolios
   and inserts a week-0 portfolio snapshot for every player using their draft
   pick costs + remaining cash. Not exposed to clients directly.';


-- ── 3. submit_draft_pick (updated) ───────────────────────────────────────────
-- Identical to Day 15 version except: calls _finalize_draft(p_market_id)
-- instead of only updating market status when all players are locked.

CREATE OR REPLACE FUNCTION public.submit_draft_pick(
  p_market_id       UUID,
  p_team_id         TEXT,
  p_price_per_share NUMERIC,
  p_total_shares    INT
)
RETURNS public.draft_picks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id       UUID    := auth.uid();
  v_state         RECORD;
  v_drafted_count INT;
  v_cash          NUMERIC;
  v_pick_num      INT;
  v_order_len     INT;
  v_next_index    INT;
  v_next_user_id  UUID;
  v_locked_arr    JSONB;
  v_all_locked    BOOL;
  v_checked       INT;
  v_rows          INT;
  v_result        public.draft_picks;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_state
  FROM   public.draft_state
  WHERE  market_id = p_market_id
  FOR UPDATE;

  IF NOT FOUND                                    THEN RAISE EXCEPTION 'draft_not_initialized'; END IF;
  IF v_state.status = 'complete'                  THEN RAISE EXCEPTION 'draft_complete';        END IF;
  IF v_state.current_turn_user_id <> v_user_id   THEN RAISE EXCEPTION 'not_your_turn';         END IF;

  SELECT COUNT(*) INTO v_drafted_count
  FROM   public.draft_picks
  WHERE  market_id = p_market_id AND team_id = p_team_id;

  IF v_drafted_count >= p_total_shares THEN
    RAISE EXCEPTION 'shares_unavailable';
  END IF;

  SELECT cash_balance INTO v_cash
  FROM   public.market_members
  WHERE  market_id = p_market_id AND user_id = v_user_id;

  IF v_cash < p_price_per_share THEN
    RAISE EXCEPTION 'not_enough_cash';
  END IF;

  SELECT COALESCE(MAX(pick_number), 0) + 1 INTO v_pick_num
  FROM   public.draft_picks
  WHERE  market_id = p_market_id;

  INSERT INTO public.draft_picks (market_id, user_id, team_id, pick_number, price_per_share)
  VALUES (p_market_id, v_user_id, p_team_id, v_pick_num, p_price_per_share)
  RETURNING * INTO v_result;

  UPDATE public.holdings
  SET    shares = shares + 1, updated_at = now()
  WHERE  market_id = p_market_id AND user_id = v_user_id AND team_id = p_team_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    INSERT INTO public.holdings (market_id, user_id, team_id, shares)
    VALUES (p_market_id, v_user_id, p_team_id, 1);
  END IF;

  UPDATE public.market_members
  SET    cash_balance = cash_balance - p_price_per_share
  WHERE  market_id = p_market_id AND user_id = v_user_id;

  INSERT INTO public.transactions
    (market_id, user_id, week, action, team_id, shares, price_per_share, total_value, source)
  VALUES
    (p_market_id, v_user_id, 0, 'buy', p_team_id, 1, p_price_per_share, p_price_per_share, 'draft');

  -- Advance turn to next non-locked player
  v_order_len   := jsonb_array_length(v_state.draft_order);
  v_locked_arr  := v_state.locked_users;
  v_next_index  := (v_state.current_turn_index + 1) % v_order_len;
  v_all_locked  := TRUE;
  v_checked     := 0;

  LOOP
    EXIT WHEN v_checked >= v_order_len;
    v_next_user_id := (v_state.draft_order ->> v_next_index)::UUID;
    IF NOT (v_locked_arr @> to_jsonb(v_next_user_id::TEXT)) THEN
      v_all_locked := FALSE;
      EXIT;
    END IF;
    v_next_index := (v_next_index + 1) % v_order_len;
    v_checked    := v_checked + 1;
  END LOOP;

  IF v_all_locked THEN
    UPDATE public.draft_state
    SET    status = 'complete', updated_at = now()
    WHERE  market_id = p_market_id;

    UPDATE public.markets SET status = 'active' WHERE id = p_market_id;

    -- Lock portfolios and snapshot week 0 values for all players
    PERFORM public._finalize_draft(p_market_id);
  ELSE
    UPDATE public.draft_state
    SET    current_turn_index   = v_next_index,
           current_turn_user_id = v_next_user_id,
           updated_at           = now()
    WHERE  market_id = p_market_id;
  END IF;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.submit_draft_pick IS
  'Enforces turn order and validates cash/shares. Writes pick + holding + transaction, then advances turn.
   When all players are locked in, calls _finalize_draft to lock portfolios and snapshot week-0 values.
   Uses FOR UPDATE on draft_state to prevent race conditions from concurrent submissions.';


-- ── 4. lock_in_draft (updated) ───────────────────────────────────────────────
-- Identical to Day 15 version except: calls _finalize_draft(p_market_id)
-- when all players are locked in.

CREATE OR REPLACE FUNCTION public.lock_in_draft(p_market_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id      UUID := auth.uid();
  v_state        RECORD;
  v_order_len    INT;
  v_next_index   INT;
  v_next_user_id UUID;
  v_locked_arr   JSONB;
  v_all_locked   BOOL;
  v_checked      INT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public.is_market_member(p_market_id) THEN RAISE EXCEPTION 'not_a_member'; END IF;

  SELECT * INTO v_state
  FROM   public.draft_state
  WHERE  market_id = p_market_id
  FOR UPDATE;

  IF NOT FOUND                   THEN RAISE EXCEPTION 'draft_not_initialized'; END IF;
  IF v_state.status = 'complete' THEN RAISE EXCEPTION 'draft_complete';        END IF;

  IF v_state.locked_users @> to_jsonb(v_user_id::TEXT) THEN
    RAISE EXCEPTION 'already_locked_in';
  END IF;

  v_locked_arr := v_state.locked_users || jsonb_build_array(v_user_id::TEXT);
  v_order_len  := jsonb_array_length(v_state.draft_order);
  v_all_locked := TRUE;
  v_checked    := 0;

  IF v_state.current_turn_user_id = v_user_id THEN
    v_next_index := (v_state.current_turn_index + 1) % v_order_len;

    LOOP
      EXIT WHEN v_checked >= v_order_len;
      v_next_user_id := (v_state.draft_order ->> v_next_index)::UUID;
      IF NOT (v_locked_arr @> to_jsonb(v_next_user_id::TEXT)) THEN
        v_all_locked := FALSE;
        EXIT;
      END IF;
      v_next_index := (v_next_index + 1) % v_order_len;
      v_checked    := v_checked + 1;
    END LOOP;
  ELSE
    v_next_index   := v_state.current_turn_index;
    v_next_user_id := v_state.current_turn_user_id;

    LOOP
      EXIT WHEN v_checked >= v_order_len;
      v_next_user_id := (v_state.draft_order ->> ((v_state.current_turn_index + v_checked) % v_order_len))::UUID;
      IF NOT (v_locked_arr @> to_jsonb(v_next_user_id::TEXT)) THEN
        v_all_locked := FALSE;
        EXIT;
      END IF;
      v_checked := v_checked + 1;
    END LOOP;

    v_next_index   := v_state.current_turn_index;
    v_next_user_id := v_state.current_turn_user_id;
  END IF;

  IF v_all_locked THEN
    UPDATE public.draft_state
    SET    locked_users = v_locked_arr,
           status       = 'complete',
           updated_at   = now()
    WHERE  market_id = p_market_id;

    UPDATE public.markets SET status = 'active' WHERE id = p_market_id;

    -- Lock portfolios and snapshot week 0 values for all players
    PERFORM public._finalize_draft(p_market_id);
  ELSE
    UPDATE public.draft_state
    SET    locked_users         = v_locked_arr,
           current_turn_index   = v_next_index,
           current_turn_user_id = v_next_user_id,
           updated_at           = now()
    WHERE  market_id = p_market_id;
  END IF;

  RETURN json_build_object(
    'locked',         TRUE,
    'draft_complete', v_all_locked
  );
END;
$$;

COMMENT ON FUNCTION public.lock_in_draft IS
  'Marks the calling user as done with the draft. If it was their turn, advances to the next player.
   If all players are locked in, calls _finalize_draft to lock portfolios and snapshot week-0 values,
   then sets draft status = complete and market.status = active.';


-- ── 5. unlock_portfolios — admin RPC ─────────────────────────────────────────
-- Called by the client when the admin advances from Week 0 to Week 1.

CREATE OR REPLACE FUNCTION public.unlock_portfolios(p_market_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  UPDATE public.market_members
  SET    is_locked = FALSE
  WHERE  market_id = p_market_id;
END;
$$;

COMMENT ON FUNCTION public.unlock_portfolios IS
  'Admin-only. Sets is_locked = FALSE for all members in a market.
   Called when the admin advances to Week 1 to open the first queue window.';


-- ── 6. submit_queue_request_validated (updated) ───────────────────────────────
-- Adds a portfolio_locked check immediately after membership verification.

CREATE OR REPLACE FUNCTION public.submit_queue_request_validated(
  p_market_id      UUID,
  p_week           INT,
  p_action         TEXT,
  p_team_id        TEXT,
  p_price_per_share NUMERIC,
  p_total_shares   INT
)
RETURNS public.queue_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id            UUID    := auth.uid();
  v_is_locked          BOOLEAN;
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

  -- ── Portfolio lock check ───────────────────────────────────────────────
  SELECT is_locked INTO v_is_locked
  FROM   public.market_members
  WHERE  market_id = p_market_id AND user_id = v_user_id;

  IF v_is_locked THEN
    RAISE EXCEPTION 'portfolio_locked';
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
  'Validates and inserts a queue request atomically. Rejects with portfolio_locked if
   the portfolio is locked post-draft. Rejects with named exception codes on any other
   validation failure. Called via supabase.rpc() from the client.';

COMMIT;

-- ============================================================
-- End of Day 19 migration.
-- After running, verify:
--   - market_members has is_locked column (default FALSE)
--   - Database > Functions shows _finalize_draft, unlock_portfolios
--   - submit_draft_pick and lock_in_draft are updated (check updated_at)
--   - submit_queue_request_validated now checks portfolio_locked
--
-- Manual test flow:
--   1. Complete a draft → check market_members.is_locked = TRUE for all players
--   2. Check portfolio_snapshots has week=0 rows for all players
--   3. Try submitting a queue request → should fail with 'portfolio_locked'
--   4. Run unlock_portfolios('<market_id>') as admin → is_locked = FALSE
--   5. Queue submission should now succeed
-- ============================================================
