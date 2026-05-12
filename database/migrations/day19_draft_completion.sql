-- ============================================================
-- Day 19 — Draft Completion & Portfolio Lock: SQL Migration
--
-- Run in the Supabase SQL Editor after day15_draft_infrastructure.sql.
-- Safe to re-run (CREATE OR REPLACE / ALTER … IF NOT EXISTS / DROP TRIGGER IF EXISTS).
--
-- What this does:
--   1. Adds is_locked BOOLEAN to market_members — true immediately
--      after the draft, false once the admin advances to Week 1.
--   2. Creates _finalize_draft(market_id) — locks all portfolios and
--      inserts week-0 portfolio snapshots for every player, using their
--      draft pick costs + remaining cash.
--   3. Creates _on_draft_complete() trigger function + trg_draft_complete
--      trigger on draft_state. Fires whenever status changes to 'complete',
--      calling _finalize_draft automatically. This avoids touching
--      submit_draft_pick or lock_in_draft (which return table row types
--      that cause type-resolution errors when recreated in migrations).
--   4. Creates unlock_portfolios(market_id) — admin-only RPC.
--      Called by advanceMarketWeek when the admin advances to Week 1.
--   5. Replaces submit_queue_request_validated with a version that:
--        a. Rejects with 'portfolio_locked' when is_locked = TRUE.
--        b. Returns VOID instead of the queue_requests row type
--           (the client never uses the return value).
-- ============================================================

BEGIN;

-- ── 1. Add is_locked to market_members ───────────────────────────────────────

ALTER TABLE public.market_members
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.market_members.is_locked IS
  'TRUE immediately after draft completes; FALSE once admin advances to Week 1.
   Prevents queue submissions while portfolios are locked post-draft.';


-- ── 2. _finalize_draft — internal helper ─────────────────────────────────────

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
  'Internal. Locks all portfolios and inserts a week-0 portfolio snapshot for every
   player using their draft pick costs + remaining cash. Called by trg_draft_complete.';


-- ── 3. Trigger: fire _finalize_draft when draft completes ────────────────────
-- Using a trigger avoids recreating submit_draft_pick / lock_in_draft, which
-- return public.draft_picks row types that cause type-resolution errors in
-- CREATE OR REPLACE FUNCTION when run as a standalone migration.

CREATE OR REPLACE FUNCTION public._on_draft_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Cast to text for safe comparison regardless of whether status is TEXT or an enum type.
  IF NEW.status::text = 'complete' AND OLD.status::text IS DISTINCT FROM 'complete' THEN
    PERFORM public._finalize_draft(NEW.market_id);
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public._on_draft_complete IS
  'Trigger function. Calls _finalize_draft when draft_state.status transitions to ''complete''.
   Uses ::text cast so the comparison works whether status is TEXT or an enum.';

DROP TRIGGER IF EXISTS trg_draft_complete ON public.draft_state;

-- No WHEN clause — condition lives inside the function body to avoid enum cast errors.
CREATE TRIGGER trg_draft_complete
AFTER UPDATE ON public.draft_state
FOR EACH ROW
EXECUTE FUNCTION public._on_draft_complete();

COMMENT ON TRIGGER trg_draft_complete ON public.draft_state IS
  'Fires once when a draft transitions to complete. Locks portfolios and snapshots week-0 values.';


-- ── 4. unlock_portfolios — admin RPC ─────────────────────────────────────────

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


-- ── 5. submit_queue_request_validated (updated) ───────────────────────────────
-- Changes from Day 12:
--   • Returns VOID instead of public.queue_requests (client never uses return value).
--   • Adds portfolio_locked check after membership verification.
-- Must DROP first — PostgreSQL cannot change a function's return type in place.

DROP FUNCTION IF EXISTS public.submit_queue_request_validated(UUID, INT, TEXT, TEXT, NUMERIC, INT);

CREATE OR REPLACE FUNCTION public.submit_queue_request_validated(
  p_market_id      UUID,
  p_week           INT,
  p_action         TEXT,
  p_team_id        TEXT,
  p_price_per_share NUMERIC,
  p_total_shares   INT
)
RETURNS VOID
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
    (p_market_id, v_user_id, p_week, p_action, p_team_id, p_price_per_share, 'pending');
END;
$$;

COMMENT ON FUNCTION public.submit_queue_request_validated IS
  'Validates and inserts a queue request atomically. Rejects with portfolio_locked if
   the portfolio is locked post-draft. Rejects with named exception codes on any other
   validation failure. Returns VOID — client checks for errors only.';

COMMIT;

-- ============================================================
-- End of Day 19 migration.
-- After running, verify in Supabase:
--   - Table Editor: market_members has is_locked column
--   - Database > Functions: _finalize_draft, _on_draft_complete, unlock_portfolios
--   - Database > Triggers: trg_draft_complete on draft_state
--   - submit_queue_request_validated updated (now returns void)
--
-- Manual test flow:
--   1. Complete a draft → market_members.is_locked = TRUE for all players
--   2. portfolio_snapshots has week=0 rows for all players
--   3. Submit queue request → fails with 'portfolio_locked'
--   4. Admin advances week → unlock_portfolios runs → is_locked = FALSE
--   5. Queue submission succeeds
-- ============================================================
