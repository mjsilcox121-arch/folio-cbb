import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useMarket } from "../context/MarketContext";
import { calcShares } from "../lib/gameUtils";
import { getSeason } from "../seasons";
import {
  supabase,
  getDraftState,
  getDraftPicks,
  getMarketMembers,
  submitDraftPick,
  lockInDraft,
} from "../lib/supabase";

export default function DraftPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { market, refresh: refreshMarkets } = useMarket();

  const [draftState, setDraftState] = useState(null);
  const [draftPicks, setDraftPicks] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pickSubmitting, setPickSubmitting] = useState(false);
  const [lockSubmitting, setLockSubmitting] = useState(false);
  const [pickError, setPickError] = useState("");
  const [search, setSearch] = useState("");

  // Teams at week 0 (draft day), sorted by adjEM desc
  const allTeams = useMemo(() => {
    const season = market?.season_id ? getSeason(market.season_id) : null;
    if (!season) return [];
    return season.TEAM_HISTORY
      .map((t) => {
        const adjEM  = t.weeklyAdjEM[0] ?? 0;
        const shares = calcShares(adjEM);
        const price  = shares > 0 ? Math.round((adjEM / shares) * 100) / 100 : 0;
        return { ...t, adjEM, shares, price };
      })
      .sort((a, b) => b.adjEM - a.adjEM);
  }, [market?.season_id]);

  const loadDraft = useCallback(async () => {
    if (!market?.id) return;
    const [state, picks, memberList] = await Promise.all([
      getDraftState(market.id),
      getDraftPicks(market.id),
      getMarketMembers(market.id),
    ]);
    setDraftState(state);
    setDraftPicks(picks);
    setMembers(memberList);
  }, [market?.id]);

  useEffect(() => {
    if (!market?.id) return;
    setLoading(true);
    setError("");
    loadDraft()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));

    // Realtime: re-load whenever draft_state or draft_picks change
    const channel = supabase
      .channel(`draft_${market.id}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "draft_state",
        filter: `market_id=eq.${market.id}`,
      }, () => { loadDraft(); refreshMarkets(); })
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "draft_picks",
        filter: `market_id=eq.${market.id}`,
      }, () => loadDraft())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [market?.id, loadDraft]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived data ───────────────────────────────────────────────────────────
  const draftOrder  = draftState?.draft_order  ?? [];
  const lockedUsers = draftState?.locked_users ?? [];

  const isMyTurn = draftState?.current_turn_user_id === user?.id;
  const amLocked = lockedUsers.includes(user?.id ?? "");
  const isDraftActive   = draftState?.status === "active";
  const isDraftComplete = draftState?.status === "complete";

  const emailMap = useMemo(
    () => Object.fromEntries(members.map((m) => [m.userId, m.email])),
    [members]
  );
  const cashMap = useMemo(
    () => Object.fromEntries(members.map((m) => [m.userId, Number(m.cashBalance)])),
    [members]
  );

  // How many of each team have been picked across all players
  const pickedCount = useMemo(() =>
    draftPicks.reduce((acc, p) => {
      acc[p.team_id] = (acc[p.team_id] || 0) + 1;
      return acc;
    }, {}),
    [draftPicks]
  );

  // Picks grouped by player
  const picksByPlayer = useMemo(() =>
    draftPicks.reduce((acc, p) => {
      (acc[p.user_id] ??= []).push(p);
      return acc;
    }, {}),
    [draftPicks]
  );

  // Filtered team list
  const filteredTeams = useMemo(() => {
    const q = search.toLowerCase();
    return q
      ? allTeams.filter(
          (t) => t.team.toLowerCase().includes(q) || t.conference.toLowerCase().includes(q)
        )
      : allTeams;
  }, [allTeams, search]);

  // ── Actions ────────────────────────────────────────────────────────────────
  async function handlePick(team) {
    if (!market?.id || pickSubmitting || !isMyTurn || amLocked) return;
    const available = team.shares - (pickedCount[team.team] || 0);
    if (available <= 0) return;
    setPickSubmitting(true);
    setPickError("");
    try {
      await submitDraftPick(market.id, team.team, team.price, team.shares);
      await loadDraft();
      refreshMarkets();
    } catch (err) {
      setPickError(err.message);
    } finally {
      setPickSubmitting(false);
    }
  }

  async function handleLockIn() {
    if (!market?.id || lockSubmitting || amLocked) return;
    if (!window.confirm("Lock in your draft? You won't be able to make any more picks during the draft round.")) return;
    setLockSubmitting(true);
    setPickError("");
    try {
      const result = await lockInDraft(market.id);
      await loadDraft();
      if (result?.draft_complete) refreshMarkets();
    } catch (err) {
      setPickError(err.message);
    } finally {
      setLockSubmitting(false);
    }
  }

  // ── Status helpers ─────────────────────────────────────────────────────────
  function currentPlayerEmail() {
    const uid = draftState?.current_turn_user_id;
    return uid ? (emailMap[uid] ?? "a player") : "—";
  }

  function shortEmail(email) {
    return email?.split("@")[0] ?? "Player";
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="container">
      <div className="topbar">
        <div className="topbar-left">
          <h1 className="app-title">Folio</h1>
          <span className="week-badge">Draft Day</span>
          {market?.name && <span className="log-market-badge">{market.name}</span>}
        </div>
        <div className="topbar-right">
          <button className="tab-btn" onClick={() => navigate("/market")}>Market</button>
          <button className="tab-btn" onClick={() => navigate("/log")}>Log</button>
          <button className="tab-btn active">Draft</button>
          <button className="tab-btn" onClick={() => navigate("/admin")}>Admin</button>
        </div>
      </div>

      {loading && (
        <div className="log-loading">Loading draft…</div>
      )}

      {error && <div className="log-error">{error}</div>}

      {/* ── Not started ───────────────────────────────────────────────────── */}
      {!loading && market && market.status === "waiting" && (
        <div className="draft-empty-state">
          <div className="draft-empty-title">Draft not started yet</div>
          <div className="draft-empty-sub">
            Waiting for the admin to initialize the draft. Check back soon.
          </div>
        </div>
      )}

      {/* ── No market ─────────────────────────────────────────────────────── */}
      {!loading && !market && (
        <div className="draft-empty-state">
          <div className="draft-empty-title">No market selected</div>
          <div className="draft-empty-sub">
            <button className="log-link-btn" onClick={() => navigate("/market")}>Go to Market</button> to join or select a market first.
          </div>
        </div>
      )}

      {/* ── Draft complete (no draft_state yet loaded but market is active) ── */}
      {!loading && !draftState && market?.status === "active" && (
        <div className="draft-empty-state">
          <div className="draft-empty-title">Draft complete</div>
          <div className="draft-empty-sub">
            The draft has ended. <button className="log-link-btn" onClick={() => navigate("/market")}>Go to Market</button> to view your portfolio and start trading.
          </div>
        </div>
      )}

      {/* ── Active or recently completed draft ────────────────────────────── */}
      {!loading && draftState && (
        <>
          {/* Turn banner */}
          <div className={`draft-banner ${isDraftComplete ? "draft-banner-done" : isMyTurn ? "draft-banner-myturn" : "draft-banner-waiting"}`}>
            <div className="draft-banner-left">
              {isDraftComplete ? (
                <>
                  <span className="draft-banner-title">Draft complete!</span>
                  <span className="draft-banner-sub">
                    All picks are in.{" "}
                    <button className="log-link-btn" style={{ fontSize: 13 }} onClick={() => navigate("/market")}>
                      Go to Market →
                    </button>
                  </span>
                </>
              ) : isMyTurn && !amLocked ? (
                <>
                  <span className="draft-banner-title">It's your turn!</span>
                  <span className="draft-banner-sub">Click a team below to make your pick.</span>
                </>
              ) : amLocked ? (
                <>
                  <span className="draft-banner-title">You're locked in</span>
                  <span className="draft-banner-sub">Waiting for others to finish their picks.</span>
                </>
              ) : (
                <>
                  <span className="draft-banner-title">Waiting for {shortEmail(currentPlayerEmail())}…</span>
                  <span className="draft-banner-sub">
                    {shortEmail(currentPlayerEmail())} is making their pick. Picks appear instantly.
                  </span>
                </>
              )}
            </div>
            {isDraftActive && !amLocked && !isDraftComplete && (
              <div className="draft-banner-right">
                <button
                  className="draft-lock-btn"
                  onClick={handleLockIn}
                  disabled={lockSubmitting}
                >
                  {lockSubmitting ? "Locking in…" : "Lock In"}
                </button>
                <div className="draft-lock-hint">Done picking? Lock in to pass your remaining turns.</div>
              </div>
            )}
          </div>

          {pickError && (
            <div className="log-error" style={{ marginBottom: "0.75rem" }}>
              {pickError}{" "}
              <button
                style={{ color: "#cf6f6f", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0, fontSize: 13 }}
                onClick={() => setPickError("")}
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Main draft layout */}
          <div className="draft-layout">
            {/* ── Team pick list ─────────────────────────────────────────── */}
            <div className="draft-teams-panel">
              <div className="draft-panel-header">
                <span className="draft-panel-title">Available Teams</span>
                <input
                  className="draft-search"
                  type="text"
                  placeholder="Search team or conference…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <div className="draft-table-wrap">
                <table className="draft-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Team</th>
                      <th>Conf</th>
                      <th>Price</th>
                      <th>Shares</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTeams.map((team, idx) => {
                      const drafted  = pickedCount[team.team] || 0;
                      const avail    = team.shares - drafted;
                      const isFull   = avail <= 0;
                      const canPick  = isMyTurn && !amLocked && !isFull && !pickSubmitting && isDraftActive;
                      const myCash   = cashMap[user?.id] ?? 0;
                      const tooExp   = canPick && team.price > myCash;

                      return (
                        <tr
                          key={team.team}
                          className={`draft-team-row${isFull ? " draft-row-full" : canPick && !tooExp ? " draft-row-pickable" : ""}`}
                        >
                          <td className="draft-rank">{allTeams.indexOf(team) + 1}</td>
                          <td className="draft-team-name">{team.team}</td>
                          <td className="draft-conf">{team.conference}</td>
                          <td className="draft-price">${team.price.toFixed(2)}</td>
                          <td className="draft-avail">
                            {isFull ? (
                              <span className="draft-full-badge">Drafted</span>
                            ) : (
                              <span className="draft-avail-count">
                                {avail}/{team.shares}
                              </span>
                            )}
                          </td>
                          <td className="draft-action">
                            {canPick && !tooExp && (
                              <button
                                className="draft-pick-btn"
                                onClick={() => handlePick(team)}
                                disabled={pickSubmitting}
                              >
                                {pickSubmitting ? "…" : "Pick"}
                              </button>
                            )}
                            {canPick && tooExp && (
                              <span className="draft-cant-afford">Can't afford</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Player sidebar ─────────────────────────────────────────── */}
            <div className="draft-sidebar-panel">
              <div className="draft-panel-title" style={{ marginBottom: 10 }}>
                Draft Order — Round {Math.floor(draftPicks.length / Math.max(draftOrder.length, 1)) + 1}
              </div>

              <div className="draft-player-list">
                {draftOrder.map((uid, i) => {
                  const isCurrentTurn = draftState.current_turn_user_id === uid;
                  const isLocked      = lockedUsers.includes(uid);
                  const isMe          = uid === user?.id;
                  const picks         = picksByPlayer[uid] ?? [];
                  const cash          = cashMap[uid] ?? 0;
                  const email         = emailMap[uid] ?? `Player ${i + 1}`;

                  return (
                    <div
                      key={uid}
                      className={`draft-player-card${isCurrentTurn && !isDraftComplete ? " draft-player-active" : ""}${isLocked ? " draft-player-locked" : ""}`}
                    >
                      <div className="draft-player-header">
                        <div className="draft-player-name">
                          <span className="draft-player-pos">{i + 1}.</span>
                          {shortEmail(email)}
                          {isMe && <span className="draft-you-tag">you</span>}
                          {isLocked && <span className="draft-locked-tag">Locked</span>}
                        </div>
                        <div className="draft-player-cash">${cash.toFixed(2)}</div>
                      </div>

                      {picks.length > 0 ? (
                        <div className="draft-picks-list">
                          {picks.map((p) => (
                            <span key={p.id} className="draft-pick-chip">
                              {p.team_id}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="draft-no-picks">No picks yet</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
