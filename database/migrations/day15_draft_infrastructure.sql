-- ============================================================
-- Day 15 — Draft Infrastructure: SQL Migration
--
-- Run in the Supabase SQL Editor after day14_transaction_log.sql.
-- Safe to re-run (CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE).
--
-- What this does:
--   1. Creates draft_state — one row per market, tracks turn order
--      and which players have locked in.
--   2. Creates draft_picks — one row per pick made during the draft.
--   3. RLS on both tables: members can read (draft is public),
--      direct writes blocked (all mutations go through RPCs).
--   4. initialize_draft(market_id) — admin only. Randomizes player
--      order, sets market.status = 'draft', creates draft_state row.
--   5. submit_draft_pick(market_id, team_id, price, total_shares) —
--      enforces turn order, validates cash and share availability,
--      writes pick + holding + transaction, advances turn.
--      Uses FOR UPDATE on draft_state to prevent race conditions.
--   6. lock_in_draft(market_id) — any member. Marks caller as done,
--      advances turn. If all players locked → marks draft complete
--      and sets market.status = 'active'.
-- ============================================================

BEGIN;

-- ── 1. draft_state ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.draft_state (
  market_id              UUID NOT NULL PRIMARY KEY
                              REFERENCES public.markets(id) ON DELETE CASCADE,
  draft_order            JSONB NOT NULL DEFAULT '[]',
  current_turn_index     INT  NOT NULL DEFAULT 0,
  current_turn_user_id   UUID REFERENCES auth.users(id),
  locked_users           JSONB NOT NULL DEFAULT '[]',
  status                 TEXT NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'complete')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.draft_state IS
  'One row per market. Tracks draft turn order, whose turn it is, and which players have locked in.';
COMMENT ON COLUMN public.draft_state.draft_order IS
  'JSONB array of user_id strings in randomized draft order.';
COMMENT ON COLUMN public.draft_state.locked_users IS
  'JSONB array of user_id strings who have locked in (no more picks).';

ALTER TABLE public.draft_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "draft_state: members can read"
  ON public.draft_state FOR SELECT
  USING (public.is_market_member(market_id));

CREATE POLICY "draft_state: admin manages all"
  ON public.draft_state FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ── 2. draft_picks ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.draft_picks (
  id              UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  market_id       UUID         NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  user_id         UUID         NOT NULL REFERENCES auth.users(id),
  team_id         TEXT         NOT NULL,
  pick_number     INT          NOT NULL,
  price_per_share NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.draft_picks IS
  'One row per draft pick. pick_number is sequential across all players in the market.';

ALTER TABLE public.draft_picks ENABLE ROW LEVEL SECURITY;

-- Draft picks are public — all market members can see every pick as it happens.
CREATE POLICY "draft_picks: members can read"
  ON public.draft_picks FOR SELECT
  USING (public.is_market_member(market_id));

-- All writes go through SECURITY DEFINER RPCs. Block direct client inserts.
CREATE POLICY "draft_picks: admin manages all"
  ON public.draft_picks FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ── 3. initialize_draft ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.initialize_draft(p_market_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shuffled UUID[];
  v_first    UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF EXISTS (SELECT 1 FROM public.draft_state WHERE market_id = p_market_id) THEN
    RAISE EXCEPTION 'draft_already_initialized';
  END IF;

  -- Shuffle member order
  SELECT ARRAY_AGG(user_id ORDER BY random())
  INTO   v_shuffled
  FROM   public.market_members
  WHERE  market_id = p_market_id;

  IF v_shuffled IS NULL OR array_length(v_shuffled, 1) = 0 THEN
    RAISE EXCEPTION 'no_members_in_market';
  END IF;

  v_first := v_shuffled[1];

  INSERT INTO public.draft_state
    (market_id, draft_order, current_turn_index, current_turn_user_id, locked_users, status)
  VALUES
    (p_market_id,
     to_jsonb(v_shuffled),
     0,
     v_first,
     '[]'::JSONB,
     'active');

  UPDATE public.markets SET status = 'draft' WHERE id = p_market_id;

  RETURN json_build_object(
    'draft_order', to_jsonb(v_shuffled),
    'first_turn',  v_first
  );
END;
$$;

COMMENT ON FUNCTION public.initialize_draft IS
  'Admin-only. Randomizes player order, writes draft_state, sets market.status = ''draft''.';


-- ── 4. submit_draft_pick ──────────────────────────────────────────────────────

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

  -- Lock draft_state row to prevent concurrent pick submissions
  SELECT * INTO v_state
  FROM   public.draft_state
  WHERE  market_id = p_market_id
  FOR UPDATE;

  IF NOT FOUND                                    THEN RAISE EXCEPTION 'draft_not_initialized'; END IF;
  IF v_state.status = 'complete'                  THEN RAISE EXCEPTION 'draft_complete';        END IF;
  IF v_state.current_turn_user_id <> v_user_id   THEN RAISE EXCEPTION 'not_your_turn';         END IF;

  -- Share availability: total_shares minus already drafted
  SELECT COUNT(*) INTO v_drafted_count
  FROM   public.draft_picks
  WHERE  market_id = p_market_id AND team_id = p_team_id;

  IF v_drafted_count >= p_total_shares THEN
    RAISE EXCEPTION 'shares_unavailable';
  END IF;

  -- Cash check
  SELECT cash_balance INTO v_cash
  FROM   public.market_members
  WHERE  market_id = p_market_id AND user_id = v_user_id;

  IF v_cash < p_price_per_share THEN
    RAISE EXCEPTION 'not_enough_cash';
  END IF;

  -- Sequential pick number across all players in this market
  SELECT COALESCE(MAX(pick_number), 0) + 1 INTO v_pick_num
  FROM   public.draft_picks
  WHERE  market_id = p_market_id;

  -- Record the pick
  INSERT INTO public.draft_picks (market_id, user_id, team_id, pick_number, price_per_share)
  VALUES (p_market_id, v_user_id, p_team_id, v_pick_num, p_price_per_share)
  RETURNING * INTO v_result;

  -- Update holdings (upsert +1 share)
  UPDATE public.holdings
  SET    shares = shares + 1, updated_at = now()
  WHERE  market_id = p_market_id AND user_id = v_user_id AND team_id = p_team_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    INSERT INTO public.holdings (market_id, user_id, team_id, shares)
    VALUES (p_market_id, v_user_id, p_team_id, 1);
  END IF;

  -- Deduct cash
  UPDATE public.market_members
  SET    cash_balance = cash_balance - p_price_per_share
  WHERE  market_id = p_market_id AND user_id = v_user_id;

  -- Transaction log (week 0 = draft day)
  INSERT INTO public.transactions
    (market_id, user_id, week, action, team_id, shares, price_per_share, total_value, source)
  VALUES
    (p_market_id, v_user_id, 0, 'buy', p_team_id, 1, p_price_per_share, p_price_per_share, 'draft');

  -- ── Advance turn to next non-locked player ──────────────────────────────
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
   Uses FOR UPDATE on draft_state to prevent race conditions from concurrent submissions.';


-- ── 5. lock_in_draft ──────────────────────────────────────────────────────────

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

  -- If it was this player's turn, advance to next non-locked player
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
    -- Not their turn — just add to locked list, check if everyone is now done
    v_next_index   := v_state.current_turn_index;
    v_next_user_id := v_state.current_turn_user_id;

    -- Count non-locked players (excluding the one just locking in)
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
   If all players are locked in, sets draft status = complete and market.status = active.';

COMMIT;

-- ============================================================
-- End of Day 15 migration.
-- After running, verify:
--   - Database > Tables shows draft_state and draft_picks
--   - Database > Functions shows initialize_draft, submit_draft_pick, lock_in_draft
-- To test from SQL Editor (admin session required for initialize_draft):
--   SELECT initialize_draft('<market_id>');
-- ============================================================
