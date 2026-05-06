// src/lib/supabase.js
// Supabase client for frontend use.
//
// Env vars (set in .env.local for local dev, Vercel dashboard for production):
//   VITE_SUPABASE_URL      — your project URL, e.g. https://xxxx.supabase.co
//   VITE_SUPABASE_ANON_KEY — public anon key (safe to expose in frontend)
//
// NEVER put the service key here. Service key usage lives in Edge Functions only.

import { createClient } from "@supabase/supabase-js";
import { getTeamData } from "./dataProvider.js";

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase env vars. " +
    "Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local"
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ── Team data ─────────────────────────────────────────────────────────────────
// Fetches teams from the active data source (Torvik, ESPN, etc.) via dataProvider.
// Falls back to the Supabase teams table if the live source is unavailable.
// This replaces direct imports of static season JS files in the data pipeline.
//
// Usage:
//   import { getTeams } from "./lib/supabase";
//   const teams = await getTeams();
//
export async function getTeams() {
  try {
    // 1. Try live data provider (reads active source from Supabase settings table)
    const liveTeams = await getTeamData();
    if (liveTeams && liveTeams.length > 0) return liveTeams;
  } catch (err) {
    console.warn("[supabase] Live data provider failed, falling back to DB:", err.message);
  }

  // 2. Fall back to teams table in Supabase (populated by seed-teams.js)
  const { data, error } = await supabase
    .from("teams")
    .select("*")
    .order("efficiency_rating", { ascending: false });

  if (error) throw new Error(`[supabase] getTeams DB fallback failed: ${error.message}`);
  return data ?? [];
}
