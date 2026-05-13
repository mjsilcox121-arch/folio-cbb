-- ============================================================
-- Day 15 Fix — Draft Functions & Schema Repair
--
-- Run this if day15_draft_infrastructure.sql rolled back (or was
-- never applied). The original migration failed because draft_state
-- already existed from day3 with a different schema, causing the
-- whole transaction to roll back before the functions were created.
--
-- This script:
--   1. Adds missing columns to draft_state (if not present)
--   2. Recreates draft_state / draft_picks RLS policies cleanly
--   3. Creates initialize_draft, submit_draft_pick, lock_in_draft
--   4. Creates draft_picks table if missing
-- ============================================================

-- ── 0. Fix draft_status enum (if the column was created as an enum type) ─────
-- Supabase sometimes infers a PG ENUM from CHECK constraints. If draft_state.status
-- is typed as draft_status rather than text, we need to add any missing values.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'draft_status') THEN
    BEGIN ALTER TYPE draft_status ADD VALUE 'waiting';  EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER TYPE draft_status ADD VALUE 'active';   EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER TYPE draft_status ADD VALUE 'complete'; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
  -- Same guard for market_status in case day20 migration hasn't run yet
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'market_status') THEN
    BEGIN ALTER TYPE market_status ADD VALUE 'draft';    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER TYPE market_status ADD VALUE 'waiting';  EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER TYPE market_status ADD VALUE 'active';   EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER TYPE market_status ADD VALUE 'complete'; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;


-- ── 1. Patch draft_state schema ──────────────────────────────────────────────
-- day3 created draft_state with only: market_id, current_turn_user_id,
-- draft_order, status. Day15 RPCs also need current_turn_index and locked_users.

ALTER TABLE public.draft_state
  ADD COLUMN IF NOT EXISTS current_turn_index INT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_users       JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ NOT NULL DEFAULT now();

-- Only add the CHECK constraint if the column is plain text (not an enum).
-- If it's an enum the values are already enforced by the type itself.
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'draft_state' AND column_name = 'status') = 'text' THEN
    ALTER TABLE public.draft_state DROP CONSTRAINT IF EXISTS draft_state_status_check;
    ALTER TABLE public.draft_state
      ADD CONSTRAINT draft_state_status_check
      CHECK (status IN ('waiting', 'active', 'complete'));
  END IF;
END $$;


-- ── 2. draft_picks (create if missing) ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.draft_picks (
  id              UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  market_id       UUID          NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  user_id         UUID          NOT NULL REFERENCES auth.users(id),
  team_id         TEXT          NOT NULL,
  pick_number     INT           NOT NULL,
  price_per_share NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

ALTER TABLE public.draft_picks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "draft_picks: members can read"  ON public.draft_picks;
DROP POLICY IF EXISTS "draft_picks: admin manages all" ON public.draft_picks;

CREATE POLICY "draft_picks: members can read"
  ON public.draft_picks FOR SELECT
  USING (public.is_market_member(market_id));

CREATE POLICY "draft_picks: admin manages all"
  ON public.draft_picks FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ── 3. draft_state RLS (clean re-create) ─────────────────────────────────────

ALTER TABLE public.draft_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users: view draft state"        ON public.draft_state;
DROP POLICY IF EXISTS "Admins: manage draft state"     ON public.draft_state;
DROP POLICY IF EXISTS "draft_state: members can read"  ON public.draft_state;
DROP POLICY IF EXISTS "draft_state: admin manages all" ON public.draft_state;

CREATE POLICY "draft_state: members can read"
  ON public.draft_state FOR SELECT
  USING (public.is_market_member(market_id));

CREATE POLICY "draft_state: admin manages all"
  ON public.draft_state FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ── 4. initialize_draft ───────────────────────────────────────────────────────

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

  IF EXISTS (SELECT 1 FROM public.draft_state WHERE market_id = p_market_id AND status <> 'waiting') THEN
    RAISE EXCEPTION 'draft_already_initialized';
  END IF;

  SELECT ARRAY_AGG(user_id ORDER BY random())
  INTO   v_shuffled
  FROM   public.market_members
  WHERE  market_id = p_market_id;

  IF v_shuffled IS NULL OR array_length(v_shuffled, 1) = 0 THEN
    RAISE EXCEPTION 'no_members_in_market';
  END IF;

  v_first := v_shuffled[1];

  -- Upsert: day3 may have inserted a 'waiting' row already
  INSERT INTO public.draft_state
    (market_id, draft_order, current_turn_index, current_turn_user_id, locked_users, status)
  VALUES
    (p_market_id, to_jsonb(v_shuffled), 0, v_first, '[]'::JSONB, 'active')
  ON CONFLICT (market_id) DO UPDATE
    SET draft_order            = to_jsonb(v_shuffled),
        current_turn_index     = 0,
        current_turn_user_id   = v_first,
        locked_users           = '[]'::JSONB,
        status                 = 'active',
        updated_at             = now();

  UPDATE public.markets SET status = 'draft' WHERE id = p_market_id;

  RETURN json_build_object(
    'draft_order', to_jsonb(v_shuffled),
    'first_turn',  v_first
  );
END;
$$;


-- ── 5. submit_draft_pick ──────────────────────────────────────────────────────

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

  IF NOT FOUND                                  THEN RAISE EXCEPTION 'draft_not_initialized'; END IF;
  IF v_state.status = 'complete'                THEN RAISE EXCEPTION 'draft_complete';        END IF;
  IF v_state.current_turn_user_id <> v_user_id THEN RAISE EXCEPTION 'not_your_turn';         END IF;

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

  v_order_len  := jsonb_array_length(v_state.draft_order);
  v_locked_arr := v_state.locked_users;
  v_next_index := (v_state.current_turn_index + 1) % v_order_len;
  v_all_locked := TRUE;
  v_checked    := 0;

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


-- ── 6. lock_in_draft ──────────────────────────────────────────────────────────

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
    SET    locked_users = v_locked_arr, status = 'complete', updated_at = now()
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

  RETURN json_build_object('locked', TRUE, 'draft_complete', v_all_locked);
END;
$$;

-- ============================================================
-- Verify after running:
--   Database > Functions: initialize_draft, submit_draft_pick, lock_in_draft
--   Database > Tables > draft_state columns: current_turn_index, locked_users
-- ============================================================
