-- =============================================================
-- FOLIO — Day 20: Ticker, Market Settings, Enum Fix
-- Run in Supabase SQL Editor
-- Safe to re-run: uses IF NOT EXISTS / DO $$ guards throughout
-- =============================================================


-- ── 1. Fix market_status if it was accidentally created as a PostgreSQL ENUM ──
-- The Day 3 schema used a text CHECK constraint (status in ('waiting','draft',...))
-- but Supabase may have inferred or applied an enum type. This adds 'draft' if needed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'market_status') THEN
    -- Try to add the value; ignore if it already exists
    BEGIN
      ALTER TYPE market_status ADD VALUE 'draft';
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;


-- ── 2. Ticker — unique short identifier per user profile ─────────────────────
-- Max 8 uppercase alphanumeric chars. UNIQUE so no two players share a ticker.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ticker TEXT DEFAULT NULL;

-- Unique index (partial — ignores NULLs so untickered accounts don't conflict)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_ticker_unique
  ON public.profiles (ticker)
  WHERE ticker IS NOT NULL;

-- RLS: users can update their own ticker
DROP POLICY IF EXISTS "Users: update own ticker" ON public.profiles;
CREATE POLICY "Users: update own ticker"
  ON public.profiles
  FOR UPDATE
  USING  (id = auth.uid())
  WITH CHECK (id = auth.uid());


-- ── 3. Market-level settings ──────────────────────────────────────────────────
-- dividend_multiplier — scales every dividend payout (default 1×)
-- dividend_overrides  — JSONB map of rule_key → override_value; {} means use defaults
ALTER TABLE public.markets
  ADD COLUMN IF NOT EXISTS dividend_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS dividend_overrides  JSONB        NOT NULL DEFAULT '{}';
