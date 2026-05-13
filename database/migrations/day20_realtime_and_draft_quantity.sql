-- ============================================================
-- Day 20 — Realtime fix + draft quantity support
--
-- 1. REPLICA IDENTITY FULL on draft_state and draft_picks so
--    Supabase Realtime can filter UPDATE events by market_id.
-- 2. Add both tables to the supabase_realtime publication.
-- 3. Rewrite submit_draft_pick to accept an optional p_quantity
--    so players can buy multiple shares in a single turn.
-- ============================================================


-- ── 1. REPLICA IDENTITY FULL ─────────────────────────────────────────────────

ALTER TABLE public.draft_state  REPLICA IDENTITY FULL;
ALTER TABLE public.draft_picks  REPLICA IDENTITY FULL;


-- ── 2. Add tables to realtime publication ────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'draft_state'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.draft_state;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'draft_picks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.draft_picks;
  END IF;
END $$;


-- ── 3. submit_draft_pick with quantity ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.submit_draft_pick(
  p_market_id       UUID,
  p_team_id         TEXT,
  p_price_per_share NUMERIC,
  p_total_shares    INT,
  p_quantity        INT DEFAULT 1
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
  i               INT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_quantity < 1   THEN RAISE EXCEPTION 'invalid_quantity';   END IF;

  SELECT * INTO v_state
  FROM   public.draft_state
  WHERE  market_id = p_market_id
  FOR UPDATE;

  IF NOT FOUND                                  THEN RAISE EXCEPTION 'draft_not_initialized'; END IF;
  IF v_state.status::TEXT = 'complete'          THEN RAISE EXCEPTION 'draft_complete';        END IF;
  IF v_state.current_turn_user_id <> v_user_id THEN RAISE EXCEPTION 'not_your_turn';         END IF;

  SELECT COUNT(*) INTO v_drafted_count
  FROM   public.draft_picks
  WHERE  market_id = p_market_id AND team_id = p_team_id;

  IF v_drafted_count + p_quantity > p_total_shares THEN
    RAISE EXCEPTION 'shares_unavailable';
  END IF;

  SELECT cash_balance INTO v_cash
  FROM   public.market_members
  WHERE  market_id = p_market_id AND user_id = v_user_id;

  IF v_cash < p_price_per_share * p_quantity THEN
    RAISE EXCEPTION 'not_enough_cash';
  END IF;

  SELECT COALESCE(MAX(pick_number), 0) INTO v_pick_num
  FROM   public.draft_picks
  WHERE  market_id = p_market_id;

  FOR i IN 1..p_quantity LOOP
    v_pick_num := v_pick_num + 1;
    INSERT INTO public.draft_picks (market_id, user_id, team_id, pick_number, price_per_share)
    VALUES (p_market_id, v_user_id, p_team_id, v_pick_num, p_price_per_share)
    RETURNING * INTO v_result;
  END LOOP;

  UPDATE public.holdings
  SET    shares = shares + p_quantity, updated_at = now()
  WHERE  market_id = p_market_id AND user_id = v_user_id AND team_id = p_team_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    INSERT INTO public.holdings (market_id, user_id, team_id, shares)
    VALUES (p_market_id, v_user_id, p_team_id, p_quantity);
  END IF;

  UPDATE public.market_members
  SET    cash_balance = cash_balance - (p_price_per_share * p_quantity)
  WHERE  market_id = p_market_id AND user_id = v_user_id;

  INSERT INTO public.transactions
    (market_id, user_id, week, action, team_id, shares, price_per_share, total_value, source)
  VALUES
    (p_market_id, v_user_id, 0, 'buy', p_team_id, p_quantity, p_price_per_share,
     p_price_per_share * p_quantity, 'draft');

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

-- ============================================================
-- After running, verify in Database > Functions:
--   submit_draft_pick now has p_quantity parameter
-- And in Table Editor > draft_state > columns: replica identity = full
-- ============================================================
