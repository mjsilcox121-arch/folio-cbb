// src/pages/AdminPage.jsx
// Day 7 — Market Management admin panel.
// Protected: only accessible when is_admin = true.

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { DIVIDEND_RULES } from "../seasons";
import {
  createMarket,
  getAllMarkets,
  updateMarketStatus,
  updateMarketSettings,
  generateInviteLink,
  addUserToMarketByEmail,
  getMarketMembers,
  removeMarketMember,
  getIsAdmin,
  executeQueue,
  initializeDraft,
  advanceMarketWeek,
  unlockPortfolios,
  getAdminPendingQueues,
} from "../lib/supabase";

// waiting → draft is handled exclusively by "Initialize Draft" (RPC).
// Direct status advance is only used for draft → active → complete.
const STATUS_NEXT = { draft: "active", active: "complete" };
const STATUS_LABELS = { waiting: "Waiting", draft: "Draft", active: "Active", complete: "Complete" };
const STATUS_COLORS = {
  waiting:  { bg: "#f0ece4", border: "#d8d0c4", color: "#666" },
  draft:    { bg: "#FAEEDA", border: "#FAC775", color: "#854F0B" },
  active:   { bg: "#EAF3DE", border: "#C0DD97", color: "#3B6D11" },
  complete: { bg: "#E8F1FA", border: "#A8C8F0", color: "#185FA5" },
};

function StatusPill({ status }) {
  const s = STATUS_COLORS[status] || STATUS_COLORS.waiting;
  return (
    <span style={{
      display: "inline-block", fontSize: 11, fontWeight: 700, fontFamily: "Arial, sans-serif",
      padding: "2px 10px", borderRadius: 20,
      background: s.bg, border: `1px solid ${s.border}`, color: s.color,
    }}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function buildDefaultOverrides() {
  return Object.fromEntries(DIVIDEND_RULES.map((r) => [r.key, r.value]));
}
const MIN_MULTIPLIER = 0.5;
const MAX_MULTIPLIER = 3;

export default function AdminPage() {
  const navigate = useNavigate();
  const { user, signOut, isAdmin: ctxIsAdmin, ticker, updateTicker } = useAuth();

  // isAdmin is already in AuthContext; we keep a local null-as-loading state
  // so the "Checking permissions…" message still shows on first render.
  const [isAdmin, setIsAdmin]     = useState(null);
  const [markets, setMarkets]     = useState([]);

  // ── Ticker edit state ─────────────────────────────────────────────────────
  const [tickerEdit, setTickerEdit]   = useState(false);
  const [tickerInput, setTickerInput] = useState(ticker ?? "");
  const [tickerSaving, setTickerSaving] = useState(false);
  const [tickerError, setTickerError]   = useState("");
  const [loadingMarkets, setLoadingMarkets] = useState(true);

  const [newName, setNewName]       = useState("");
  const [newMax, setNewMax]         = useState(8);
  const [newSeason, setNewSeason]   = useState("2024");
  const [createError, setCreateError] = useState("");
  const [creating, setCreating]     = useState(false);

  const [expanded, setExpanded]           = useState({});
  const [members, setMembers]             = useState({});
  const [loadingMembers, setLoadingMembers] = useState({});
  const [inviteLink, setInviteLink]       = useState({});
  const [inviteLoading, setInviteLoading] = useState({});
  const [addEmail, setAddEmail]           = useState({});
  const [addError, setAddError]           = useState({});
  const [addLoading, setAddLoading]       = useState({});
  const [statusLoading, setStatusLoading]   = useState({});
  const [execLoading, setExecLoading]       = useState({});
  const [execResult, setExecResult]         = useState({});
  const [execError, setExecError]           = useState({});
  const [draftLoading, setDraftLoading]     = useState({});
  const [draftError, setDraftError]         = useState({});
  const [advWeekLoading, setAdvWeekLoading] = useState({});
  const [advWeekError, setAdvWeekError]     = useState({});
  const [logoutError, setLogoutError]       = useState("");

  // ── Pending queues (admin-only view) ─────────────────────────────────────────
  const [pendingQueues, setPendingQueues]         = useState({});  // { [marketId]: [] }
  const [pendingQueuesLoading, setPendingQueuesLoading] = useState({});
  const [pendingQueuesError, setPendingQueuesError]     = useState({});

  // ── Per-market settings state ─────────────────────────────────────────────
  const [settingsEdit, setSettingsEdit]     = useState({});  // { [marketId]: bool }
  const [settingsData, setSettingsData]     = useState({});  // { [marketId]: { mult, overrides } }
  const [settingsSaving, setSettingsSaving] = useState({});
  const [settingsError, setSettingsError]   = useState({});

  useEffect(() => {
    if (!user) return;
    // Use the profile already loaded in AuthContext (ctxIsAdmin) to avoid an extra DB call,
    // but fall back to the getIsAdmin() query for the permission gate.
    if (ctxIsAdmin !== undefined && ctxIsAdmin !== null) {
      setIsAdmin(ctxIsAdmin);
    } else {
      getIsAdmin().then((result) => setIsAdmin(result)).catch(() => setIsAdmin(false));
    }
  }, [user, ctxIsAdmin]);

  const loadMarkets = useCallback(async () => {
    setLoadingMarkets(true);
    try { setMarkets(await getAllMarkets()); }
    catch (err) { console.error("[AdminPage] loadMarkets:", err.message); }
    finally { setLoadingMarkets(false); }
  }, []);

  useEffect(() => { if (isAdmin) loadMarkets(); }, [isAdmin, loadMarkets]);

  async function loadPendingQueues(marketId) {
    setPendingQueuesLoading((s) => ({ ...s, [marketId]: true }));
    setPendingQueuesError((s) => ({ ...s, [marketId]: "" }));
    try {
      const data = await getAdminPendingQueues(marketId);
      setPendingQueues((s) => ({ ...s, [marketId]: data }));
    } catch (err) {
      setPendingQueuesError((s) => ({ ...s, [marketId]: err.message }));
    } finally {
      setPendingQueuesLoading((s) => ({ ...s, [marketId]: false }));
    }
  }

  async function loadMembers(marketId) {
    setLoadingMembers((s) => ({ ...s, [marketId]: true }));
    try {
      const data = await getMarketMembers(marketId);
      setMembers((s) => ({ ...s, [marketId]: data }));
    }
    catch (err) { console.error("[AdminPage] loadMembers:", err.message); }
    finally { setLoadingMembers((s) => ({ ...s, [marketId]: false })); }
  }

  function toggleExpand(market) {
    const marketId = market.id;
    const nowOpen = !expanded[marketId];
    setExpanded((s) => ({ ...s, [marketId]: nowOpen }));
    if (nowOpen) {
      if (!members[marketId]) loadMembers(marketId);
      if (market.status === "active") loadPendingQueues(marketId);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!newName.trim()) { setCreateError("Market name is required."); return; }
    setCreating(true); setCreateError("");
    try { await createMarket(newName.trim(), Number(newMax), newSeason); setNewName(""); setNewMax(8); setNewSeason("2024"); await loadMarkets(); }
    catch (err) { setCreateError(err.message); }
    finally { setCreating(false); }
  }

  async function handleGenerateInvite(marketId) {
    setInviteLoading((s) => ({ ...s, [marketId]: true }));
    try {
      const url = await generateInviteLink(marketId);
      setInviteLink((s) => ({ ...s, [marketId]: url }));
    }
    catch (err) { alert("Failed to generate invite link: " + err.message); }
    finally { setInviteLoading((s) => ({ ...s, [marketId]: false })); }
  }

  async function handleAddUser(marketId) {
    const email = (addEmail[marketId] || "").trim();
    if (!email) { setAddError((s) => ({ ...s, [marketId]: "Enter an email address." })); return; }
    setAddLoading((s) => ({ ...s, [marketId]: true }));
    setAddError((s) => ({ ...s, [marketId]: "" }));
    try {
      await addUserToMarketByEmail(marketId, email);
      setAddEmail((s) => ({ ...s, [marketId]: "" }));
      await loadMembers(marketId);
    } catch (err) { setAddError((s) => ({ ...s, [marketId]: err.message })); }
    finally { setAddLoading((s) => ({ ...s, [marketId]: false })); }
  }

  async function handleRemoveMember(marketId, userId, email) {
    if (!window.confirm(`Remove ${email} from this market?`)) return;
    try {
      await removeMarketMember(marketId, userId);
      setMembers((s) => ({ ...s, [marketId]: (s[marketId] || []).filter((m) => m.userId !== userId) }));
    } catch (err) { alert("Failed to remove member: " + err.message); }
  }

  async function handleAdvanceStatus(market) {
    const next = STATUS_NEXT[market.status];
    if (!next) return;
    if (!window.confirm(`Move "${market.name}" from ${STATUS_LABELS[market.status]} to ${STATUS_LABELS[next]}?`)) return;
    setStatusLoading((s) => ({ ...s, [market.id]: true }));
    try { await updateMarketStatus(market.id, next); await loadMarkets(); }
    catch (err) { alert("Failed to update status: " + err.message); }
    finally { setStatusLoading((s) => ({ ...s, [market.id]: false })); }
  }

  async function handleExecuteQueue(market) {
    const week = market.current_week ?? 0;
    if (!window.confirm(`Execute queue for "${market.name}" — Week ${week}?\n\nThis will process all pending buy/sell requests in portfolio-value order. This cannot be undone.`)) return;
    setExecLoading((s) => ({ ...s, [market.id]: true }));
    setExecError((s) => ({ ...s, [market.id]: "" }));
    setExecResult((s) => ({ ...s, [market.id]: null }));
    try {
      const result = await executeQueue(market.id, week);
      setExecResult((s) => ({ ...s, [market.id]: result }));
    } catch (err) {
      setExecError((s) => ({ ...s, [market.id]: err.message }));
    } finally {
      setExecLoading((s) => ({ ...s, [market.id]: false }));
    }
  }

  async function handleInitializeDraft(market) {
    if (!window.confirm(`Initialize draft for "${market.name}"?\n\nThis will randomize the player order and set the market to Draft status. This cannot be undone.`)) return;
    setDraftLoading((s) => ({ ...s, [market.id]: true }));
    setDraftError((s) => ({ ...s, [market.id]: "" }));
    try {
      await initializeDraft(market.id);
      await loadMarkets();
    } catch (err) {
      setDraftError((s) => ({ ...s, [market.id]: err.message }));
    } finally {
      setDraftLoading((s) => ({ ...s, [market.id]: false }));
    }
  }

  async function handleAdvanceWeek(market) {
    const currentWeek = market.current_week ?? 0;
    const nextWeek = currentWeek + 1;
    if (!window.confirm(
      `Advance "${market.name}" to Week ${nextWeek}?\n\n` +
      (currentWeek === 0
        ? "This will open trading for all players (Week 1). Make sure the queue has been executed first."
        : `This will advance from Week ${currentWeek} to Week ${nextWeek}. Make sure the queue has been executed first.`)
    )) return;
    setAdvWeekLoading((s) => ({ ...s, [market.id]: true }));
    setAdvWeekError((s) => ({ ...s, [market.id]: "" }));
    try {
      await advanceMarketWeek(market.id, nextWeek);
      if (currentWeek === 0) await unlockPortfolios(market.id);
      await loadMarkets();
    } catch (err) {
      setAdvWeekError((s) => ({ ...s, [market.id]: err.message }));
    } finally {
      setAdvWeekLoading((s) => ({ ...s, [market.id]: false }));
    }
  }

  async function handleSaveTicker() {
    const val = tickerInput.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    if (!val) { setTickerError("Ticker can't be empty."); return; }
    setTickerSaving(true); setTickerError("");
    try {
      await updateTicker(val);
      setTickerEdit(false);
    } catch (err) {
      setTickerError(err.message);
    } finally {
      setTickerSaving(false);
    }
  }

  function openSettingsForMarket(market) {
    const dbMult = market.dividend_multiplier ?? 1;
    const dbOver = market.dividend_overrides ?? {};
    const overrides = Object.keys(dbOver).length > 0 ? dbOver : buildDefaultOverrides();
    setSettingsData((s) => ({ ...s, [market.id]: { mult: Number(dbMult), overrides } }));
    setSettingsEdit((s) => ({ ...s, [market.id]: true }));
  }

  async function handleSaveSettings(marketId) {
    const data = settingsData[marketId];
    if (!data) return;
    setSettingsSaving((s) => ({ ...s, [marketId]: true }));
    setSettingsError((s) => ({ ...s, [marketId]: "" }));
    try {
      await updateMarketSettings(marketId, {
        dividendMultiplier: data.mult,
        dividendOverrides:  data.overrides,
      });
      setSettingsEdit((s) => ({ ...s, [marketId]: false }));
      await loadMarkets();
    } catch (err) {
      setSettingsError((s) => ({ ...s, [marketId]: err.message }));
    } finally {
      setSettingsSaving((s) => ({ ...s, [marketId]: false }));
    }
  }

  async function handleLogout() {
    setLogoutError("");
    try { await signOut(); navigate("/login", { replace: true }); }
    catch { setLogoutError("Sign out failed."); }
  }

  if (isAdmin === null) {
    return <div className="container"><div style={{ padding: "3rem", textAlign: "center", color: "#aaa", fontFamily: "Arial, sans-serif" }}>Checking permissions…</div></div>;
  }

  if (!isAdmin) {
    return (
      <div className="container">
        <div className="topbar">
          <div className="topbar-left"><h1 className="app-title">Admin</h1></div>
          <div className="topbar-right">
            <button className="tab-btn" onClick={() => navigate("/market")}>Market</button>
            <button className="tab-btn signout-btn" onClick={handleLogout}>Sign out</button>
          </div>
        </div>
        <div style={{ padding: "3rem", textAlign: "center", color: "#993C1D", fontFamily: "Arial, sans-serif" }}>You do not have admin access.</div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="topbar">
        <div className="topbar-left" style={{ alignItems: "center", gap: 8 }}>
          <h1 className="app-title">Folio</h1>
          {/* Ticker display / inline edit */}
          {!tickerEdit ? (
            <span
              className="ticker-badge"
              onClick={() => { setTickerInput(ticker ?? ""); setTickerEdit(true); setTickerError(""); }}
              title="Click to edit your ticker"
              style={{ cursor: "pointer" }}
            >
              {ticker ? `[${ticker}]` : "[Add ticker]"}
            </span>
          ) : (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                autoFocus
                maxLength={8}
                value={tickerInput}
                onChange={(e) => setTickerInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveTicker(); if (e.key === "Escape") setTickerEdit(false); }}
                style={{ ...inputStyle, width: 80, height: 28, fontSize: 12, padding: "0 8px", fontFamily: "monospace", letterSpacing: 1 }}
                placeholder="e.g. MAXS"
                disabled={tickerSaving}
              />
              <button onClick={handleSaveTicker} disabled={tickerSaving} style={{ ...primarySmallBtnStyle, height: 28, fontSize: 11 }}>
                {tickerSaving ? "…" : "Save"}
              </button>
              <button onClick={() => setTickerEdit(false)} style={{ ...secondaryBtnStyle, height: 28, fontSize: 11 }}>Cancel</button>
              {tickerError && <span style={{ fontSize: 11, color: "#993C1D", fontFamily: "Arial, sans-serif" }}>{tickerError}</span>}
            </span>
          )}
          <span className="week-badge">Admin</span>
        </div>
        <div className="topbar-right">
          <button className="tab-btn" onClick={() => navigate("/market")}>Market</button>
          <button className="tab-btn" onClick={() => navigate("/portfolio")}>My portfolio</button>
          <button className="tab-btn" onClick={() => navigate("/log")}>Log</button>
          <button className="tab-btn" onClick={() => navigate("/draft")}>Draft</button>
          <button className="tab-btn active">Admin</button>
          <button className="tab-btn signout-btn" onClick={handleLogout} title={`Sign out (${user?.email})`}>Sign out</button>
        </div>
      </div>

      {logoutError && (
        <div style={{ background: "#2e1a1a", border: "1px solid #4a2a2a", color: "#cf6f6f", borderRadius: 6, padding: "0.5rem 0.85rem", fontSize: "0.85rem", marginBottom: "1rem" }}>
          {logoutError}
        </div>
      )}

      {/* Create market */}
      <div className="chart-card" style={{ marginBottom: "1.25rem" }}>
        <div className="chart-title">Create market</div>
        <form onSubmit={handleCreate} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: 2, minWidth: 180 }}>
            <label style={labelStyle}>Market name</label>
            <input style={inputStyle} type="text" placeholder="e.g. Folio Beta 2025"
              value={newName} onChange={(e) => setNewName(e.target.value)} disabled={creating} />
          </div>
          <div style={{ width: 110 }}>
            <label style={labelStyle}>Season</label>
            <select style={inputStyle} value={newSeason} onChange={(e) => setNewSeason(e.target.value)} disabled={creating}>
              {["2024","2023","2018","2014"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ width: 130 }}>
            <label style={labelStyle}>Max players</label>
            <select style={inputStyle} value={newMax} onChange={(e) => setNewMax(e.target.value)} disabled={creating}>
              {[6,7,8,9,10,11,12,13,14,15].map((n) => <option key={n} value={n}>{n} players</option>)}
            </select>
          </div>
          <button type="submit" disabled={creating} style={primaryBtnStyle(creating)}>
            {creating ? "Creating…" : "Create market"}
          </button>
        </form>
        {createError && <div style={errorStyle}>{createError}</div>}
      </div>

      {/* Markets list */}
      <div className="section-title">Markets</div>

      {loadingMarkets ? (
        <div style={{ color: "#aaa", fontFamily: "Arial, sans-serif", fontSize: 14, padding: "1rem 0" }}>Loading…</div>
      ) : markets.length === 0 ? (
        <div className="empty-log">No markets yet. Create one above.</div>
      ) : markets.map((market) => (
        <div key={market.id} className="chart-card" style={{ marginBottom: "1rem" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: "#0d1b2a", fontFamily: "Arial, sans-serif" }}>{market.name}</span>
              <span style={{ marginLeft: 10, fontSize: 12, color: "#999", fontFamily: "Arial, sans-serif" }}>max {market.max_players}</span>
            </div>
            <StatusPill status={market.status} />
            {STATUS_NEXT[market.status] && (
              <button
                onClick={() => handleAdvanceStatus(market)}
                disabled={statusLoading[market.id]}
                style={{ fontFamily: "Arial, sans-serif", fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 6,
                  border: "1px solid #C0DD97", background: "#EAF3DE", color: "#3B6D11", whiteSpace: "nowrap",
                  cursor: statusLoading[market.id] ? "not-allowed" : "pointer", opacity: statusLoading[market.id] ? 0.5 : 1 }}
              >
                {statusLoading[market.id] ? "Updating…" : `→ ${STATUS_LABELS[STATUS_NEXT[market.status]]}`}
              </button>
            )}
            <button onClick={() => toggleExpand(market)}
              style={{ fontFamily: "Arial, sans-serif", fontSize: 12, color: "#185FA5", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
              {expanded[market.id] ? "Hide ▲" : "Manage ▾"}
            </button>
          </div>

          {/* Expanded panel */}
          {expanded[market.id] && (
            <div style={{ borderTop: "1px solid #e8e4dc", paddingTop: 16, marginTop: 14 }}>

              {/* Invite link */}
              <div style={{ marginBottom: 18 }}>
                <div style={sectionLabel}>Invite link</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {inviteLink[market.id] ? (
                    <>
                      <input readOnly value={inviteLink[market.id]}
                        style={{ ...inputStyle, flex: 1, minWidth: 200, background: "#f7f5f0", color: "#444", cursor: "text" }}
                        onFocus={(e) => e.target.select()} />
                      <button onClick={() => navigator.clipboard.writeText(inviteLink[market.id]).catch(() => {})} style={secondaryBtnStyle}>Copy</button>
                      <button onClick={() => handleGenerateInvite(market.id)} style={secondaryBtnStyle}>Regenerate</button>
                    </>
                  ) : (
                    <button onClick={() => handleGenerateInvite(market.id)} disabled={inviteLoading[market.id]} style={secondaryBtnStyle}>
                      {inviteLoading[market.id] ? "Generating…" : "Generate invite link"}
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "#aaa", fontFamily: "Arial, sans-serif", marginTop: 5 }}>
                  Any logged-in user who follows this link will join the market automatically.
                </div>
              </div>

              {/* Add by email */}
              <div style={{ marginBottom: 18 }}>
                <div style={sectionLabel}>Add player by email</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input type="email" placeholder="player@example.com"
                    value={addEmail[market.id] || ""}
                    onChange={(e) => setAddEmail((s) => ({ ...s, [market.id]: e.target.value }))}
                    style={{ ...inputStyle, flex: 1, minWidth: 220 }}
                    disabled={addLoading[market.id]}
                    onKeyDown={(e) => e.key === "Enter" && handleAddUser(market.id)} />
                  <button onClick={() => handleAddUser(market.id)} disabled={addLoading[market.id]} style={primarySmallBtnStyle}>
                    {addLoading[market.id] ? "Adding…" : "Add player"}
                  </button>
                </div>
                {addError[market.id] && <div style={errorStyle}>{addError[market.id]}</div>}
                <div style={{ fontSize: 11, color: "#aaa", fontFamily: "Arial, sans-serif", marginTop: 5 }}>
                  User must have a Folio account. Creates their market_members and portfolios rows.
                </div>
              </div>

              {/* Simulation controls */}
              <div style={{ marginBottom: 18 }}>
                <div style={sectionLabel}>Simulation controls</div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ fontSize: 12, color: "#888", fontFamily: "Arial, sans-serif" }}>
                    Current week: <strong style={{ color: "#0d1b2a" }}>{market.current_week ?? 0}</strong>
                  </div>
                  {market.status === "waiting" && (
                    <button
                      onClick={() => handleInitializeDraft(market)}
                      disabled={draftLoading[market.id]}
                      style={{
                        fontFamily: "Arial, sans-serif", fontSize: 13, fontWeight: 600,
                        padding: "0 16px", height: 38, borderRadius: 7, cursor: draftLoading[market.id] ? "not-allowed" : "pointer",
                        background: draftLoading[market.id] ? "#ccc" : "#854F0B", color: "#fff", border: "none", whiteSpace: "nowrap",
                      }}
                    >
                      {draftLoading[market.id] ? "Initializing…" : "Initialize Draft"}
                    </button>
                  )}
                  <button
                    onClick={() => handleExecuteQueue(market)}
                    disabled={execLoading[market.id]}
                    style={{
                      fontFamily: "Arial, sans-serif", fontSize: 13, fontWeight: 600,
                      padding: "0 16px", height: 38, borderRadius: 7, cursor: execLoading[market.id] ? "not-allowed" : "pointer",
                      background: execLoading[market.id] ? "#ccc" : "#185FA5", color: "#fff", border: "none", whiteSpace: "nowrap",
                    }}
                  >
                    {execLoading[market.id] ? "Executing…" : "Execute Queue"}
                  </button>
                  {market.status === "active" && (
                    <button
                      onClick={() => handleAdvanceWeek(market)}
                      disabled={advWeekLoading[market.id]}
                      style={{
                        fontFamily: "Arial, sans-serif", fontSize: 13, fontWeight: 600,
                        padding: "0 16px", height: 38, borderRadius: 7, cursor: advWeekLoading[market.id] ? "not-allowed" : "pointer",
                        background: advWeekLoading[market.id] ? "#ccc" : "#3B6D11", color: "#fff", border: "none", whiteSpace: "nowrap",
                      }}
                    >
                      {advWeekLoading[market.id] ? "Advancing…" : `Advance to Week ${(market.current_week ?? 0) + 1}`}
                    </button>
                  )}
                </div>
                {draftError[market.id] && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "#993C1D", fontFamily: "Arial, sans-serif" }}>
                    {draftError[market.id]}
                  </div>
                )}
                {advWeekError[market.id] && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "#993C1D", fontFamily: "Arial, sans-serif" }}>
                    {advWeekError[market.id]}
                  </div>
                )}
                {execResult[market.id] && (
                  <div style={{ marginTop: 8, fontSize: 13, fontFamily: "Arial, sans-serif", color: "#0d1b2a" }}>
                    {execResult[market.id].total === 0
                      ? <span style={{ color: "#aaa" }}>No pending requests — queue was already empty.</span>
                      : <>
                          Done: <strong style={{ color: "#3B6D11" }}>{execResult[market.id].succeeded} executed</strong>
                          {execResult[market.id].failed > 0 && (
                            <>, <strong style={{ color: "#993C1D" }}>{execResult[market.id].failed} failed</strong></>
                          )}
                          {" "}of {execResult[market.id].total} total requests.
                        </>
                    }
                  </div>
                )}
                {execError[market.id] && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "#993C1D", fontFamily: "Arial, sans-serif" }}>
                    {execError[market.id]}
                  </div>
                )}
                <div style={{ marginTop: 6, fontSize: 11, color: "#aaa", fontFamily: "Arial, sans-serif" }}>
                  Execute Queue before Advance Week. Running twice is safe — second run processes 0 requests.
                </div>
              </div>

              {/* Pending queues — only shown for active markets */}
              {market.status === "active" && (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ ...sectionLabel, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>Pending queues</span>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 10, color: "#bbb", fontFamily: "Arial, sans-serif", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                        Admin-only view
                      </span>
                      <button onClick={() => loadPendingQueues(market.id)}
                        style={{ fontSize: 11, color: "#185FA5", background: "none", border: "none", cursor: "pointer", fontFamily: "Arial, sans-serif" }}>
                        Refresh
                      </button>
                    </div>
                  </div>

                  {pendingQueuesLoading[market.id] ? (
                    <div style={{ color: "#aaa", fontSize: 13, fontFamily: "Arial, sans-serif" }}>Loading…</div>
                  ) : pendingQueuesError[market.id] ? (
                    <div style={{ color: "#993C1D", fontSize: 13, fontFamily: "Arial, sans-serif" }}>{pendingQueuesError[market.id]}</div>
                  ) : !pendingQueues[market.id] || pendingQueues[market.id].length === 0 ? (
                    <div style={{ color: "#aaa", fontSize: 13, fontFamily: "Arial, sans-serif" }}>No pending requests this week.</div>
                  ) : (() => {
                    // Group by player name
                    const byPlayer = {};
                    for (const r of pendingQueues[market.id]) {
                      (byPlayer[r.playerName] ??= []).push(r);
                    }
                    return (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {Object.entries(byPlayer).map(([name, reqs]) => (
                          <div key={name} style={{ background: "#f7f5f0", borderRadius: 6, padding: "8px 12px" }}>
                            <div style={{ fontFamily: "Arial, sans-serif", fontSize: 12, fontWeight: 700, color: "#0d1b2a", marginBottom: 6 }}>
                              {name}
                              <span style={{ fontWeight: 400, color: "#aaa", marginLeft: 8 }}>
                                Week {reqs[0].week} · {reqs.length} request{reqs.length !== 1 ? "s" : ""}
                              </span>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                              {reqs.map((r) => (
                                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontFamily: "Arial, sans-serif" }}>
                                  <span style={{
                                    fontWeight: 700, fontSize: 10, padding: "1px 7px", borderRadius: 10,
                                    background: r.action === "buy" ? "#EAF3DE" : "#FAECE7",
                                    color:      r.action === "buy" ? "#3B6D11"  : "#993C1D",
                                    border:     r.action === "buy" ? "1px solid #C0DD97" : "1px solid #F5C4B3",
                                  }}>
                                    {r.action === "buy" ? "Buy" : "Sell"}
                                  </span>
                                  <span style={{ flex: 1, color: "#0d1b2a" }}>{r.teamId}</span>
                                  <span style={{ color: "#888" }}>${r.pricePerShare.toFixed(2)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Market settings */}
              <div style={{ marginBottom: 18 }}>
                <div style={{ ...sectionLabel, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Market settings</span>
                  {!settingsEdit[market.id] && (
                    <button onClick={() => openSettingsForMarket(market)} style={{ fontSize: 11, color: "#185FA5", background: "none", border: "none", cursor: "pointer", fontFamily: "Arial, sans-serif" }}>
                      Edit
                    </button>
                  )}
                </div>
                {!settingsEdit[market.id] ? (
                  <div style={{ fontSize: 12, color: "#888", fontFamily: "Arial, sans-serif" }}>
                    Dividend multiplier: <strong style={{ color: "#0d1b2a" }}>×{Number(market.dividend_multiplier ?? 1).toFixed(2)}</strong>
                    {" · "}
                    Overrides: <strong style={{ color: "#0d1b2a" }}>
                      {market.dividend_overrides && Object.keys(market.dividend_overrides).length > 0 ? "Custom" : "Defaults"}
                    </strong>
                  </div>
                ) : (
                  <div>
                    {/* Multiplier */}
                    <div style={{ marginBottom: 12 }}>
                      <label style={labelStyle}>
                        Dividend multiplier <span style={{ color: "#854F0B", fontWeight: 700, marginLeft: 6 }}>×{(settingsData[market.id]?.mult ?? 1).toFixed(2)}</span>
                      </label>
                      <input type="range" min={MIN_MULTIPLIER} max={MAX_MULTIPLIER} step="0.05"
                        value={settingsData[market.id]?.mult ?? 1}
                        onChange={(e) => setSettingsData((s) => ({ ...s, [market.id]: { ...s[market.id], mult: Number(e.target.value) } }))}
                        style={{ width: "100%", accentColor: "#854F0B" }}
                      />
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#aaa", fontFamily: "Arial, sans-serif" }}>
                        <span>{MIN_MULTIPLIER}×</span><span>1×</span><span>{MAX_MULTIPLIER}×</span>
                      </div>
                    </div>
                    {/* Dividend rule overrides */}
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ ...labelStyle, marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
                        <span>Dividend amounts</span>
                        <button style={{ fontSize: 11, color: "#185FA5", background: "none", border: "none", cursor: "pointer", fontFamily: "Arial, sans-serif", fontWeight: 600 }}
                          onClick={() => setSettingsData((s) => ({ ...s, [market.id]: { ...s[market.id], overrides: buildDefaultOverrides() } }))}>
                          Reset to defaults
                        </button>
                      </div>
                      <div style={{ maxHeight: 280, overflowY: "auto", border: "1px solid #e8e4dc", borderRadius: 6 }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "Arial, sans-serif" }}>
                          <thead>
                            <tr style={{ background: "#f7f5f0" }}>
                              <th style={{ padding: "6px 10px", textAlign: "left", color: "#888", fontWeight: 600 }}>Event</th>
                              <th style={{ padding: "6px 10px", textAlign: "right", color: "#888", fontWeight: 600 }}>Default</th>
                              <th style={{ padding: "6px 10px", textAlign: "right", color: "#888", fontWeight: 600 }}>Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {DIVIDEND_RULES.map((r) => {
                              const cur = settingsData[market.id]?.overrides?.[r.key] ?? r.value;
                              const isCustom = cur !== r.value;
                              return (
                                <tr key={r.key} style={{ borderTop: "1px solid #f0ece4", background: isCustom ? "#FAEEDA" : undefined }}>
                                  <td style={{ padding: "5px 10px", color: "#0d1b2a" }}>{r.label}</td>
                                  <td style={{ padding: "5px 10px", textAlign: "right", color: "#aaa" }}>${r.value}</td>
                                  <td style={{ padding: "5px 10px", textAlign: "right" }}>
                                    <input type="number" min="0" step="1" value={cur}
                                      style={{ width: 64, padding: "2px 6px", fontSize: 12, border: "1px solid #ddd", borderRadius: 4, textAlign: "right", fontFamily: "Arial, sans-serif" }}
                                      onChange={(e) => {
                                        const n = Number(e.target.value);
                                        if (Number.isFinite(n) && n >= 0)
                                          setSettingsData((s) => ({ ...s, [market.id]: { ...s[market.id], overrides: { ...s[market.id].overrides, [r.key]: n } } }));
                                      }}
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    {/* Save / cancel */}
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <button onClick={() => handleSaveSettings(market.id)} disabled={settingsSaving[market.id]} style={primarySmallBtnStyle}>
                        {settingsSaving[market.id] ? "Saving…" : "Save settings"}
                      </button>
                      <button onClick={() => setSettingsEdit((s) => ({ ...s, [market.id]: false }))} style={secondaryBtnStyle}>Cancel</button>
                    </div>
                    {settingsError[market.id] && <div style={errorStyle}>{settingsError[market.id]}</div>}
                  </div>
                )}
              </div>

              {/* Members */}
              <div>
                <div style={sectionLabel}>
                  Members
                  <button onClick={() => loadMembers(market.id)}
                    style={{ marginLeft: 8, fontSize: 11, color: "#185FA5", background: "none", border: "none", cursor: "pointer", fontFamily: "Arial, sans-serif" }}>
                    Refresh
                  </button>
                </div>
                {loadingMembers[market.id] ? (
                  <div style={{ color: "#aaa", fontSize: 13, fontFamily: "Arial, sans-serif" }}>Loading members…</div>
                ) : !members[market.id] || members[market.id].length === 0 ? (
                  <div style={{ color: "#aaa", fontSize: 13, fontFamily: "Arial, sans-serif" }}>No members yet.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {members[market.id].map((m) => (
                      <div key={m.userId} style={{ display: "flex", alignItems: "center", gap: 10, background: "#f7f5f0", borderRadius: 6, padding: "7px 12px" }}>
                        <span style={{ flex: 1, fontFamily: "Arial, sans-serif", fontSize: 13, color: "#0d1b2a" }}>{m.email}</span>
                        <span style={{ fontSize: 11, color: "#bbb", fontFamily: "Arial, sans-serif", whiteSpace: "nowrap" }}>
                          joined {new Date(m.joinedAt).toLocaleDateString()}
                        </span>
                        <button onClick={() => handleRemoveMember(market.id, m.userId, m.email)}
                          style={{ fontSize: 11, fontFamily: "Arial, sans-serif", fontWeight: 600, padding: "2px 8px", borderRadius: 5,
                            background: "#FAECE7", border: "1px solid #F5C4B3", color: "#993C1D", cursor: "pointer" }}>
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const labelStyle = { display: "block", fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: "Arial, sans-serif", marginBottom: 4 };
const inputStyle = { fontSize: 13, padding: "0 12px", height: 38, borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: "#1a1a1a", fontFamily: "Arial, sans-serif", outline: "none", boxSizing: "border-box", width: "100%" };
const errorStyle = { marginTop: 6, fontSize: 12, color: "#993C1D", fontFamily: "Arial, sans-serif" };
const sectionLabel = { fontSize: 11, fontWeight: 600, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: "Arial, sans-serif", marginBottom: 8, display: "flex", alignItems: "center" };
const secondaryBtnStyle = { fontSize: 12, fontFamily: "Arial, sans-serif", fontWeight: 600, padding: "0 14px", height: 38, borderRadius: 7, border: "1px solid #ddd", background: "#fff", color: "#0d1b2a", cursor: "pointer", whiteSpace: "nowrap" };
const primarySmallBtnStyle = { fontSize: 13, fontFamily: "Arial, sans-serif", fontWeight: 600, padding: "0 16px", height: 38, borderRadius: 7, background: "#0d1b2a", color: "#fff", border: "none", cursor: "pointer", whiteSpace: "nowrap" };
function primaryBtnStyle(disabled) {
  return { fontSize: 13, fontFamily: "Arial, sans-serif", fontWeight: 600, padding: "0 20px", height: 38, borderRadius: 8, background: disabled ? "#ccc" : "#0d1b2a", color: "#fff", border: "none", cursor: disabled ? "not-allowed" : "pointer", whiteSpace: "nowrap" };
}
