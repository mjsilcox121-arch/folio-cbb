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
    .from("profiles")
    .select("id")
    .eq("username", email)
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
  const { data: market, error: mktError } = await supabase
    .from("markets")
    .select("starting_budget")
    .eq("id", marketId)
    .single();
  if (mktError) throw new Error("[supabase] addUserToMarketByEmail (fetch market) failed: " + mktError.message);
  const { error: mmError } = await supabase
    .from("market_members")
    .insert({ market_id: marketId, user_id: userId, cash_balance: market.starting_budget ?? 100 });
  if (mmError) throw new Error("[supabase] addUserToMarketByEmail (market_members) failed: " + mmError.message);
}

export async function getMarketMembers(marketId) {
  const { data, error } = await supabase
    .from("market_members")
    .select("user_id, joined_at, cash_balance, profiles(username)")
    .eq("market_id", marketId);
  if (error) throw new Error("[supabase] getMarketMembers failed: " + error.message);
  return (data ?? []).map((row) => ({
    userId:      row.user_id,
    joinedAt:    row.joined_at,
    cashBalance: row.cash_balance,
    email:       row.profiles?.username ?? "unknown",
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
// ── Portfolio persistence (Day 8) ──────────────────────────────────────────────
// Functions for reading and writing portfolio state to/from the database.
// Replaces the in-memory React state that existed prior to Day 8.

/**
 * Fetch the current player's portfolio state for a given market.
 * Returns { cashBalance, dividendsEarned, holdings: { teamId: shares } }.
 */
export async function getPortfolioState(marketId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const [memberResult, holdingsResult] = await Promise.all([
    supabase
      .from("market_members")
      .select("cash_balance, dividends_earned")
      .eq("market_id", marketId)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("holdings")
      .select("team_id, shares")
      .eq("market_id", marketId)
      .eq("user_id", user.id)
      .gt("shares", 0),
  ]);

  if (memberResult.error)   throw new Error("[supabase] getPortfolioState (member): "   + memberResult.error.message);
  if (holdingsResult.error) throw new Error("[supabase] getPortfolioState (holdings): " + holdingsResult.error.message);

  if (!memberResult.data) return { cashBalance: 0, dividendsEarned: 0, holdings: {} };

  const holdings = {};
  (holdingsResult.data ?? []).forEach((h) => { holdings[h.team_id] = h.shares; });

  return {
    cashBalance:     Number(memberResult.data.cash_balance),
    dividendsEarned: Number(memberResult.data.dividends_earned),
    holdings,
  };
}

/**
 * Record a share purchase: upsert holding (+1), deduct cash, log transaction.
 * Returns { newShares, newCashBalance }.
 */
export async function buyShareDB(marketId, teamId, pricePerShare, week) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: existing } = await supabase
    .from("holdings")
    .select("id, shares")
    .eq("market_id", marketId).eq("user_id", user.id).eq("team_id", teamId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("holdings")
      .update({ shares: existing.shares + 1, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) throw new Error("[supabase] buyShareDB (update holding): " + error.message);
  } else {
    const { error } = await supabase
      .from("holdings")
      .insert({ market_id: marketId, user_id: user.id, team_id: teamId, shares: 1 });
    if (error) throw new Error("[supabase] buyShareDB (insert holding): " + error.message);
  }

  const { data: member, error: readErr } = await supabase
    .from("market_members")
    .select("cash_balance")
    .eq("market_id", marketId).eq("user_id", user.id)
    .single();
  if (readErr) throw new Error("[supabase] buyShareDB (read cash): " + readErr.message);

  const newCash = Math.round((Number(member.cash_balance) - pricePerShare) * 100) / 100;
  const { error: cashErr } = await supabase
    .from("market_members")
    .update({ cash_balance: newCash })
    .eq("market_id", marketId).eq("user_id", user.id);
  if (cashErr) throw new Error("[supabase] buyShareDB (update cash): " + cashErr.message);

  const { error: txErr } = await supabase.from("transactions").insert({
    market_id: marketId, user_id: user.id, week,
    action: "buy", team_id: teamId, shares: 1,
    price_per_share: pricePerShare, total_value: pricePerShare, source: "queue",
  });
  if (txErr) console.warn("[supabase] buyShareDB (transaction log):", txErr.message);

  return { newShares: (existing?.shares ?? 0) + 1, newCashBalance: newCash };
}

/**
 * Record a share sale: decrement holding, add cash, log transaction.
 * Returns { newShares, newCashBalance }.
 */
export async function sellShareDB(marketId, teamId, pricePerShare, week) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: existing, error: holdErr } = await supabase
    .from("holdings")
    .select("id, shares")
    .eq("market_id", marketId).eq("user_id", user.id).eq("team_id", teamId)
    .single();
  if (holdErr || !existing || existing.shares === 0)
    throw new Error("[supabase] sellShareDB: No shares to sell for " + teamId);

  const { error: updateErr } = await supabase
    .from("holdings")
    .update({ shares: existing.shares - 1, updated_at: new Date().toISOString() })
    .eq("id", existing.id);
  if (updateErr) throw new Error("[supabase] sellShareDB (update holding): " + updateErr.message);

  const { data: member, error: readErr } = await supabase
    .from("market_members")
    .select("cash_balance")
    .eq("market_id", marketId).eq("user_id", user.id)
    .single();
  if (readErr) throw new Error("[supabase] sellShareDB (read cash): " + readErr.message);

  const newCash = Math.round((Number(member.cash_balance) + pricePerShare) * 100) / 100;
  const { error: cashErr } = await supabase
    .from("market_members")
    .update({ cash_balance: newCash })
    .eq("market_id", marketId).eq("user_id", user.id);
  if (cashErr) throw new Error("[supabase] sellShareDB (update cash): " + cashErr.message);

  const { error: txErr } = await supabase.from("transactions").insert({
    market_id: marketId, user_id: user.id, week,
    action: "sell", team_id: teamId, shares: 1,
    price_per_share: pricePerShare, total_value: pricePerShare, source: "queue",
  });
  if (txErr) console.warn("[supabase] sellShareDB (transaction log):", txErr.message);

  return { newShares: existing.shares - 1, newCashBalance: newCash };
}

/**
 * Fetch all transactions for the current user in a market (newest first).
 */
export async function getTransactionHistory(marketId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("market_id", marketId)
    .eq("user_id", user.id)
    .order("executed_at", { ascending: false });
  if (error) throw new Error("[supabase] getTransactionHistory: " + error.message);
  return data ?? [];
}

/**
 * Fetch all dividend payouts for the current user in a market (newest first).
 */
export async function getDividendHistory(marketId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("dividend_payouts")
    .select("*")
    .eq("market_id", marketId)
    .eq("user_id", user.id)
    .order("paid_at", { ascending: false });
  if (error) throw new Error("[supabase] getDividendHistory: " + error.message);
  return data ?? [];
}

/**
 * Fetch portfolio snapshots for the current user in a market (oldest first).
 */
export async function getPortfolioSnapshots(marketId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("portfolio_snapshots")
    .select("week, total_value, cash_balance, created_at")
    .eq("market_id", marketId)
    .eq("user_id", user.id)
    .order("week", { ascending: true });
  if (error) throw new Error("[supabase] getPortfolioSnapshots: " + error.message);
  return data ?? [];
}

/**
 * Upsert a portfolio value snapshot for a given week (written on advanceWeek).
 */
export async function savePortfolioSnapshot(marketId, week, totalValue, cashBalance) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { error } = await supabase
    .from("portfolio_snapshots")
    .upsert(
      {
        market_id:    marketId,
        user_id:      user.id,
        week,
        total_value:  Math.round(totalValue  * 100) / 100,
        cash_balance: Math.round(cashBalance * 100) / 100,
      },
      { onConflict: "market_id,user_id,week" }
    );
  if (error) throw new Error("[supabase] savePortfolioSnapshot: " + error.message);
}

/**
 * Insert dividend payout rows for a week's dividend events.
 * dividendEntries: [{ teamId, eventKey, eventLabel, sharesOwned, baseValue, multiplier, payout }]
 */
export async function saveDividendPayouts(marketId, week, dividendEntries) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  if (!dividendEntries.length) return;

  const rows = dividendEntries.map((d) => ({
    market_id:    marketId,
    user_id:      user.id,
    week,
    team_id:      d.teamId,
    event_key:    d.eventKey,
    event_label:  d.eventLabel,
    shares_owned: d.sharesOwned,
    base_value:   d.baseValue,
    multiplier:   d.multiplier,
    payout:       Math.round(d.payout * 100) / 100,
  }));

  const { error } = await supabase.from("dividend_payouts").insert(rows);
  if (error) throw new Error("[supabase] saveDividendPayouts: " + error.message);
}

/**
 * Update cash_balance and dividends_earned for the current user in a market.
 * Called after advanceWeek computes and saves dividend payouts.
 */
export async function updateMemberFinancials(marketId, newCashBalance, additionalDividends) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: member, error: readErr } = await supabase
    .from("market_members")
    .select("dividends_earned")
    .eq("market_id", marketId).eq("user_id", user.id)
    .single();
  if (readErr) throw new Error("[supabase] updateMemberFinancials (read): " + readErr.message);

  const { error } = await supabase
    .from("market_members")
    .update({
      cash_balance:     Math.round(newCashBalance * 100) / 100,
      dividends_earned: Math.round((Number(member.dividends_earned) + additionalDividends) * 100) / 100,
    })
    .eq("market_id", marketId).eq("user_id", user.id);
  if (error) throw new Error("[supabase] updateMemberFinancials (update): " + error.message);
}

/**
 * Advance the market's current_week counter (admin only — enforced by RLS).
 */
export async function advanceMarketWeek(marketId, newWeek) {
  const { error } = await supabase
    .from("markets")
    .update({ current_week: newWeek })
    .eq("id", marketId);
  if (error) throw new Error("[supabase] advanceMarketWeek: " + error.message);
}

// ── Queue requests (Day 11) ────────────────────────────────────────────────

const QUEUE_ERROR_MESSAGES = {
  not_enough_cash:    "Not enough cash (your other pending buys are reserving the rest)",
  shares_unavailable: "No shares available — all shares are owned or queued by other players",
  no_shares_to_sell:  "You don't own any shares in this team",
  queue_full:         "Queue full — you already have 10 pending requests this week",
  not_a_member:       "You are not a member of this market",
  not_authenticated:  "Not signed in",
};

/**
 * Submit a buy or sell request via the server-side validated RPC.
 * pricePerShare and totalShares are client-computed from season data and
 * sent to the server for cash-sufficiency and share-availability checks.
 */
export async function submitQueueRequest(marketId, week, action, teamId, pricePerShare, totalShares) {
  const { data, error } = await supabase.rpc("submit_queue_request_validated", {
    p_market_id:       marketId,
    p_week:            week,
    p_action:          action,
    p_team_id:         teamId,
    p_price_per_share: pricePerShare,
    p_total_shares:    totalShares ?? 0,
  });
  if (error) {
    // Supabase surfaces RAISE EXCEPTION messages in error.message
    const code = error.message?.trim();
    const friendly = QUEUE_ERROR_MESSAGES[code] ?? error.message;
    throw new Error(friendly);
  }
  return data;
}

/**
 * Fetch the current user's queue requests for a specific week (oldest first).
 * Returns all statuses so the UI can show pending + history.
 */
export async function getMyQueueRequests(marketId, week) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("queue_requests")
    .select("*")
    .eq("market_id", marketId)
    .eq("user_id", user.id)
    .eq("week", week)
    .order("created_at", { ascending: true });
  if (error) throw new Error("[supabase] getMyQueueRequests: " + error.message);
  return data ?? [];
}

/**
 * Admin-only: execute all pending queue requests for a market week.
 * Returns { total, succeeded, failed }.
 */
export async function executeQueue(marketId, week) {
  const { data, error } = await supabase.rpc("execute_queue", {
    p_market_id: marketId,
    p_week:      week,
  });
  if (error) {
    const msg = error.message?.trim();
    if (msg === "not_authorized") throw new Error("Admin access required.");
    throw new Error("[supabase] executeQueue: " + error.message);
  }
  return data; // { total, succeeded, failed }
}

/**
 * Delete a pending queue request. RLS prevents cancelling executed/failed rows.
 */
export async function cancelQueueRequest(requestId) {
  const { error } = await supabase
    .from("queue_requests")
    .delete()
    .eq("id", requestId);
  if (error) throw new Error("[supabase] cancelQueueRequest: " + error.message);
}


/**
 * Fetch all players in a market ranked by portfolio value.
 * Returns [{ userId, email, cashBalance, totalValue }] sorted desc by totalValue.
 * totalValue comes from the latest portfolio_snapshot if available, otherwise falls
 * back to cash_balance (player hasn't advanced a week yet).
 */
export async function getLeaderboard(marketId) {
  const [membersResult, snapshotsResult] = await Promise.all([
    supabase
      .from("market_members")
      .select("user_id, cash_balance, profiles(username)")
      .eq("market_id", marketId),
    supabase
      .from("portfolio_snapshots")
      .select("user_id, week, total_value")
      .eq("market_id", marketId)
      .order("week", { ascending: false }),
  ]);

  if (membersResult.error)   throw new Error("[supabase] getLeaderboard (members): "   + membersResult.error.message);
  if (snapshotsResult.error) throw new Error("[supabase] getLeaderboard (snapshots): " + snapshotsResult.error.message);

  const latestSnap = {};
  (snapshotsResult.data ?? []).forEach((s) => {
    if (!latestSnap[s.user_id]) latestSnap[s.user_id] = s;
  });

  return (membersResult.data ?? [])
    .map((m) => ({
      userId:      m.user_id,
      email:       m.profiles?.username ?? "Player",
      cashBalance: Number(m.cash_balance),
      totalValue:  latestSnap[m.user_id]
        ? Number(latestSnap[m.user_id].total_value)
        : Number(m.cash_balance),
    }))
    .sort((a, b) => b.totalValue - a.totalValue);
}

// ── Draft (Day 15) ────────────────────────────────────────────────────────────

const DRAFT_ERROR_MESSAGES = {
  not_authorized:           "Admin access required.",
  draft_already_initialized: "Draft has already been initialized for this market.",
  no_members_in_market:     "No players have joined this market yet.",
  draft_not_initialized:    "Draft has not been started yet.",
  draft_complete:           "The draft is already complete.",
  not_your_turn:            "It's not your turn to pick.",
  shares_unavailable:       "That team's shares are fully drafted.",
  not_enough_cash:          "Not enough cash to pick this team.",
  not_authenticated:        "Not signed in.",
  not_a_member:             "You are not a member of this market.",
  already_locked_in:        "You've already locked in.",
  market_not_in_waiting_status: "Market must be in 'waiting' status to start a draft.",
};

function draftError(error) {
  const code = error.message?.trim();
  return new Error(DRAFT_ERROR_MESSAGES[code] ?? error.message);
}

/** Admin only. Randomizes player order and initializes the draft. */
export async function initializeDraft(marketId) {
  const { data, error } = await supabase.rpc("initialize_draft", { p_market_id: marketId });
  if (error) throw draftError(error);
  return data; // { draft_order, first_turn }
}

/** Read the current draft state for a market (null if not started). */
export async function getDraftState(marketId) {
  const { data, error } = await supabase
    .from("draft_state")
    .select("*")
    .eq("market_id", marketId)
    .maybeSingle();
  if (error) throw new Error("[supabase] getDraftState: " + error.message);
  return data;
}

/** Read all picks for a market, oldest first. */
export async function getDraftPicks(marketId) {
  const { data, error } = await supabase
    .from("draft_picks")
    .select("id, user_id, team_id, pick_number, price_per_share, created_at")
    .eq("market_id", marketId)
    .order("pick_number", { ascending: true });
  if (error) throw new Error("[supabase] getDraftPicks: " + error.message);
  return data ?? [];
}

/** Submit a draft pick. Enforced server-side: turn order, cash, share availability. */
export async function submitDraftPick(marketId, teamId, pricePerShare, totalShares) {
  const { data, error } = await supabase.rpc("submit_draft_pick", {
    p_market_id:       marketId,
    p_team_id:         teamId,
    p_price_per_share: pricePerShare,
    p_total_shares:    totalShares ?? 0,
  });
  if (error) throw draftError(error);
  return data;
}

/** Mark the current user as done picking. Advances turn; completes draft if everyone is locked. */
export async function lockInDraft(marketId) {
  const { data, error } = await supabase.rpc("lock_in_draft", { p_market_id: marketId });
  if (error) throw draftError(error);
  return data; // { locked: true, draft_complete: bool }
}

/**
 * Fetch all executed and failed queue requests for a market, across all players.
 * Requires the Day 14 RLS policy — co-members can read executed/failed rows.
 * Returns rows sorted by week DESC, executed_at ASC (execution order within week).
 * Each row includes playerEmail resolved from the profiles table.
 */
export async function getTransactionLog(marketId) {
  const { data, error } = await supabase
    .from("queue_requests")
    .select("id, user_id, week, action, team_id, status, failure_reason, executed_at, price_per_share")
    .eq("market_id", marketId)
    .in("status", ["executed", "failed"])
    .order("week", { ascending: false })
    .order("executed_at", { ascending: true });
  if (error) throw new Error("[supabase] getTransactionLog: " + error.message);
  const rows = data ?? [];

  // Resolve player emails from profiles
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const emailMap = {};
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, username")
      .in("id", userIds);
    (profiles ?? []).forEach((p) => { emailMap[p.id] = p.username; });
  }

  return rows.map((r) => ({ ...r, playerEmail: emailMap[r.user_id] ?? "Player" }));
}

/**
 * Check whether the current user has is_admin = true in the profiles table.
 * Used by AdminPage to gate the admin UI (Day 8: fixes the old users-table query).
 */
export async function getIsAdmin() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  return data?.is_admin === true;
}
