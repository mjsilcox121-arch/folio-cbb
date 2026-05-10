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

// ── Teams ──────────────────────────────────────────────────────────────────

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

// ── Markets ────────────────────────────────────────────────────────────────

export async function createMarket(name, maxPlayers, seasonId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data, error } = await supabase
    .from("markets")
    .insert({ name, max_players: maxPlayers, season_id: seasonId, created_by: user.id, status: "waiting" })
    .select()
    .single();
  if (error) throw new Error("[supabase] createMarket failed: " + error.message);
  return data;
}

export async function getAllMarkets() {
  const { data, error } = await supabase
    .from("markets")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error("[supabase] getAllMarkets failed: " + error.message);
  return data ?? [];
}

export async function getMyMarkets() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("market_members")
    .select("market_id, joined_at, markets(*)")
    .eq("user_id", user.id);
  if (error) throw new Error("[supabase] getMyMarkets failed: " + error.message);
  return (data ?? []).map((row) => row.markets);
}

export async function getMarketById(marketId) {
  const { data, error } = await supabase
    .from("markets")
    .select("*")
    .eq("id", marketId)
    .single();
  if (error) throw new Error("[supabase] getMarketById failed: " + error.message);
  return data;
}

export async function updateMarketStatus(marketId, status) {
  const { data, error } = await supabase
    .from("markets")
    .update({ status })
    .eq("id", marketId)
    .select()
    .single();
  if (error) throw new Error("[supabase] updateMarketStatus failed: " + error.message);
  return data;
}

export async function generateInviteLink(marketId) {
  const token = crypto.randomUUID();
  const { error } = await supabase
    .from("markets")
    .update({ invite_token: token })
    .eq("id", marketId);
  if (error) throw new Error("[supabase] generateInviteLink failed: " + error.message);
  const base = window.location.origin;
  return `${base}/join/${token}`;
}

export async function getMarketByInviteToken(token) {
  const { data, error } = await supabase
    .from("markets")
    .select("*")
    .eq("invite_token", token)
    .single();
  if (error) throw new Error("[supabase] getMarketByInviteToken failed: " + error.message);
  return data;
}

// ── Market membership ──────────────────────────────────────────────────────

export async function isMarketMember(marketId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from("market_members")
    .select("market_id")
    .eq("market_id", marketId)
    .eq("user_id", user.id)
    .maybeSingle();
  return !!data;
}

export async function joinMarket(marketId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const already = await isMarketMember(marketId);
  if (already) return;
  // Fetch starting_budget from the market so cash_balance is initialised correctly
  const { data: market, error: mktError } = await supabase
    .from("markets")
    .select("starting_budget")
    .eq("id", marketId)
    .single();
  if (mktError) throw new Error("[supabase] joinMarket (fetch market) failed: " + mktError.message);
  const { error: mmError } = await supabase
    .from("market_members")
    .insert({ market_id: marketId, user_id: user.id, cash_balance: market.starting_budget ?? 100 });
  if (mmError) throw new Error("[supabase] joinMarket (market_members) failed: " + mmError.message);
}

export async function addUserToMarketByEmail(marketId, email) {
  const { data: targetUser, error: lookupError } = await supabase
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (lookupError) throw new Error("[supabase] User lookup failed: " + lookupError.message);
  if (!targetUser) throw new Error(`No account found for ${email}. The user must sign up first.`);
  const userId = targetUser.id;
  const { data: existing } = await supabase
    .from("market_members")
    .select("market_id")
    .eq("market_id", marketId)
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) throw new Error(`${email} is already a member of this market.`);
  const { error: mmError } = await supabase
    .from("market_members")
    .insert({ market_id: marketId, user_id: userId });
  if (mmError) throw new Error("[supabase] addUserToMarketByEmail (market_members) failed: " + mmError.message);
  const { error: pfError } = await supabase
    .from("portfolios")
    .insert({ market_id: marketId, user_id: userId, cash: 100.00, locked: false });
  if (pfError) throw new Error("[supabase] addUserToMarketByEmail (portfolios) failed: " + pfError.message);
}

export async function getMarketMembers(marketId) {
  const { data, error } = await supabase
    .from("market_members")
    .select("user_id, joined_at, users(email)")
    .eq("market_id", marketId);
  if (error) throw new Error("[supabase] getMarketMembers failed: " + error.message);
  return (data ?? []).map((row) => ({
    userId: row.user_id,
    joinedAt: row.joined_at,
    email: row.users?.email ?? "unknown",
  }));
}

export async function removeMarketMember(marketId, userId) {
  const { error } = await supabase
    .from("market_members")
    .delete()
    .eq("market_id", marketId)
    .eq("user_id", userId);
  if (error) throw new Error("[supabase] removeMarketMember failed: " + error.message);
}
