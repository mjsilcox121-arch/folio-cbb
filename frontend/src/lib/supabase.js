// src/lib/supabase.js
import { createClient } from "@supabase/supabase-js";
import { getTeams as getTeamsFromProvider } from "./dataProvider.js";

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase env vars. " +
    "Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local"
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function getTeams() {
  try {
    const liveTeams = await getTeamsFromProvider();
    if (liveTeams && liveTeams.length > 0) return liveTeams;
  } catch (err) {
    console.warn("[supabase] Live data provider failed, falling back to DB:", err.message);
  }
  const { data, error } = await supabase
    .from("teams")
    .select("*")
    .order("efficiency_rating", { ascending: false });
  if (error) {
    throw new Error("[supabase] getTeams DB fallback failed: " + error.message);
  }
  return data ?? [];
}
