import { useState, useMemo, useEffect, useCallback } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import {
  SEASONS,
  getSeason,
  DEFAULT_SEASON_ID,
  DIVIDEND_RULES,
  ruleKeyForEventLabel,
} from "./seasons";
import { calcShares, sharePrice, teamColor } from "./lib/gameUtils";
import { useAuth } from "./context/AuthContext";
import { useMarket } from "./context/MarketContext";
import ProtectedRoute from "./components/ProtectedRoute";
import MarketTable from "./components/MarketTable";
import Leaderboard from "./components/Leaderboard";
import QueuePanel from "./components/QueuePanel";
import PortfolioView from "./components/PortfolioView";
import TeamModal from "./components/TeamModal";
import SettingsModal from "./components/SettingsModal";
import LoginPage from "./pages/LoginPage";
import LogPage from "./pages/LogPage";
import DraftPage from "./pages/DraftPage";
import AdminPage from "./pages/AdminPage";
import JoinPage from "./pages/JoinPage";
import {
  getPortfolioState,
  buyShareDB,
  sellShareDB,
  getTransactionHistory,
  getDividendHistory,
  getPortfolioSnapshots,
  savePortfolioSnapshot,
  saveDividendPayouts,
  updateMemberFinancials,
  advanceMarketWeek,
  unlockPortfolios,
  getLeaderboard,
  submitQueueRequest,
  getMyQueueRequests,
  cancelQueueRequest,
} from "./lib/supabase";
import "./App.css";

const DEFAULT_BUDGET     = 100;
const DEFAULT_MULTIPLIER = 1;

function buildDefaultOverrides() {
  return Object.fromEntries(DIVIDEND_RULES.map((r) => [r.key, r.value]));
}

// ── Market + Portfolio pages share all game state ─────────────────────────────
// Portfolio state (holdings, cash, trade history) now lives in Supabase (Day 8).
// UI state (search, sort, modals) remains local React state.
function GameLayout() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { market, markets, setActiveMarketId, refresh: refreshMarkets } = useMarket();

  // ── Settings (initialized from market on load) ─────────────────────────────
  const [seasonId, setSeasonId]                     = useState(DEFAULT_SEASON_ID);
  const [budget, setBudget]                         = useState(DEFAULT_BUDGET);
  const [dividendMultiplier, setDividendMultiplier] = useState(DEFAULT_MULTIPLIER);
  const [dividendOverrides, setDividendOverrides]   = useState(buildDefaultOverrides);
  const [showSettings, setShowSettings]             = useState(false);
  const [logoutError, setLogoutError]               = useState("");

  const season = useMemo(() => getSeason(seasonId), [seasonId]);
  const { WEEKS, TEAM_HISTORY, SCHEDULES, EVENTS_BY_WEEK, label: seasonLabel } = season;

  // ── DB-backed game state ───────────────────────────────────────────────────
  // cashBalance replaces the old separate cash + dividendBank states.
  // dividendsEarned is a running cumulative total for display purposes.
  const [week, setWeek]                         = useState(0);
  const [portfolio, setPortfolio]               = useState({});   // { teamName: sharesOwned }
  const [cashBalance, setCashBalance]           = useState(DEFAULT_BUDGET);
  const [dividendsEarned, setDividendsEarned]   = useState(0);
  const [tradeLog, setTradeLog]                 = useState([]);
  const [dividendLog, setDividendLog]           = useState([]);
  const [portfolioHistory, setPortfolioHistory] = useState([DEFAULT_BUDGET]);

  // ── Loading / async flags ──────────────────────────────────────────────────
  const [portfolioLoading, setPortfolioLoading]   = useState(false);
  const [tradePending, setTradePending]           = useState(false);
  const [tradeError, setTradeError]               = useState("");

  // ── Leaderboard (Day 10) ───────────────────────────────────────────────────
  const [leaderboard, setLeaderboard]               = useState([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);

  // ── Queue (Day 11) ─────────────────────────────────────────────────────────
  const [queueRequests, setQueueRequests]           = useState([]);
  const [queueSubmitting, setQueueSubmitting]       = useState(false);
  const [queueError, setQueueError]                 = useState("");
  const [portfolioLocked, setPortfolioLocked]       = useState(false);

  // ── UI state ───────────────────────────────────────────────────────────────
  const [search, setSearch]             = useState("");
  const [confFilter, setConfFilter]     = useState("");
  const [sortCol, setSortCol]           = useState("adjEM");
  const [sortAsc, setSortAsc]           = useState(false);
  const [selectedTeam, setSelectedTeam] = useState(null);

  // ── Derived constants ──────────────────────────────────────────────────────
  const draftMode      = week === 0;
  const startingBudget = market?.starting_budget ? Number(market.starting_budget) : budget;
  const buyingPower    = cashBalance; // combined cash + dividends in one balance

  // ── Load portfolio from DB when market changes ─────────────────────────────
  const loadPortfolioFromDB = useCallback(async (marketId, startBudget) => {
    setPortfolioLoading(true);
    setTradeError("");
    try {
      const [state, txns, divs, snaps] = await Promise.all([
        getPortfolioState(marketId),
        getTransactionHistory(marketId),
        getDividendHistory(marketId),
        getPortfolioSnapshots(marketId),
      ]);

      setPortfolio(state.holdings);
      setCashBalance(state.cashBalance > 0 ? state.cashBalance : startBudget);
      setDividendsEarned(state.dividendsEarned);
      setPortfolioLocked(state.isLocked ?? false);

      // Map DB transactions → UI tradeLog shape
      setTradeLog(
        txns.map((t) => ({
          week:   t.week,
          team:   t.team_id,
          action: t.action.toUpperCase(),
          qty:    t.shares,
          price:  Number(t.price_per_share),
          total:  Number(t.total_value),
        }))
      );

      // Map DB dividend_payouts → UI dividendLog shape
      setDividendLog(
        divs.map((d) => ({
          week:        d.week,
          team:        d.team_id,
          event:       d.event_label,
          baseValue:   Number(d.base_value),
          multiplier:  Number(d.multiplier),
          sharesOwned: d.shares_owned,
          payout:      Number(d.payout),
        }))
      );

      // Build portfolioHistory: [startBudget, ...snapshots sorted by week]
      const sortedSnaps = [...snaps].sort((a, b) => a.week - b.week);
      setPortfolioHistory([startBudget, ...sortedSnaps.map((s) => Number(s.total_value))]);
    } catch (err) {
      console.error("[GameLayout] loadPortfolioFromDB failed:", err.message);
    } finally {
      setPortfolioLoading(false);
    }
  }, []); // state setters are stable

  // Sync settings and reload portfolio whenever the active market changes
  useEffect(() => {
    if (!market?.id) return;

    if (market.season_id) setSeasonId(market.season_id);
    setWeek(market.current_week ?? 0);
    if (market.dividend_multiplier != null) setDividendMultiplier(Number(market.dividend_multiplier));
    if (market.dividend_overrides && Object.keys(market.dividend_overrides).length > 0) {
      setDividendOverrides({ ...buildDefaultOverrides(), ...market.dividend_overrides });
    }
    const startBudget = market.starting_budget ? Number(market.starting_budget) : DEFAULT_BUDGET;
    setBudget(startBudget);

    loadPortfolioFromDB(market.id, startBudget);
    loadLeaderboardFromDB(market.id);
    loadQueueFromDB(market.id, market.current_week ?? 0);
  }, [market?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived game data ──────────────────────────────────────────────────────
  const teamsThisWeek = useMemo(() => TEAM_HISTORY.map((t) => {
    const adjEM     = t.weeklyAdjEM[week];
    const prevAdjEM = week > 0 ? t.weeklyAdjEM[week - 1] : null;
    const shares    = calcShares(adjEM);
    const price     = Math.round((adjEM / shares) * 100) / 100;
    const prevPrice = prevAdjEM != null
      ? Math.round((prevAdjEM / calcShares(prevAdjEM)) * 100) / 100
      : null;
    return {
      ...t, adjEM, prevAdjEM, shares, price, prevPrice,
      adjEMDelta: prevAdjEM != null ? Math.round((adjEM - prevAdjEM) * 100) / 100 : null,
      priceDelta: prevPrice != null ? Math.round((price - prevPrice) * 100) / 100 : null,
      record:     t.weeklyRecord[week],
    };
  }), [week, TEAM_HISTORY]);

  const holdingsValue = useMemo(() =>
    Object.entries(portfolio).reduce((sum, [name, owned]) => {
      const t = teamsThisWeek.find((t) => t.team === name);
      return t ? sum + t.price * owned : sum;
    }, 0), [portfolio, teamsThisWeek]);

  const totalValue = holdingsValue + cashBalance;
  const gain       = totalValue - startingBudget;

  // Per-team dividend totals derived from dividendLog (no separate state needed)
  const teamDividends = useMemo(() =>
    dividendLog.reduce((acc, d) => {
      acc[d.team] = Math.round(((acc[d.team] || 0) + d.payout) * 100) / 100;
      return acc;
    }, {}), [dividendLog]);

  const pieSlices = useMemo(() => {
    const slices = [];
    if (cashBalance > 0.005) slices.push({ label: "Cash & Dividends", value: cashBalance, color: "#B0BEC5" });
    Object.entries(portfolio).filter(([, o]) => o > 0).forEach(([name, owned], idx) => {
      const t      = teamsThisWeek.find((t) => t.team === name);
      const posVal = t ? t.price * owned : 0;
      const divVal = teamDividends[name] || 0;
      const col    = teamColor(idx);
      if (posVal > 0.005) slices.push({ label: `${name} (value)`, value: posVal, color: col });
      if (divVal > 0.005) slices.push({ label: `${name} (divs)`,  value: divVal, color: col + "99" });
    });
    return slices;
  }, [cashBalance, portfolio, teamsThisWeek, teamDividends]);
  const pieTotal = pieSlices.reduce((s, sl) => s + sl.value, 0);

  const conferences = useMemo(() => [...new Set(TEAM_HISTORY.map((t) => t.conference))].sort(), [TEAM_HISTORY]);
  const maxAdjEM    = Math.max(...teamsThisWeek.map((t) => t.adjEM));

  const filteredTeams = useMemo(() => teamsThisWeek
    .filter((t) => {
      const s = search.toLowerCase();
      return (!s || t.team.toLowerCase().includes(s) || t.conference.toLowerCase().includes(s))
        && (!confFilter || t.conference === confFilter);
    })
    .sort((a, b) => {
      const av = a[sortCol], bv = b[sortCol];
      if (av == null) return 1; if (bv == null) return -1;
      if (typeof av === "string") return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortAsc ? av - bv : bv - av;
    }), [teamsThisWeek, search, confFilter, sortCol, sortAsc]);

  const portfolioRows = useMemo(() => Object.entries(portfolio)
    .filter(([, o]) => o > 0)
    .map(([name, owned], idx) => {
      const t          = teamsThisWeek.find((t) => t.team === name);
      const value      = (t?.price ?? 0) * owned;
      const prevVal    = t?.prevPrice != null ? t.prevPrice * owned : null;
      const valueDelta = prevVal != null ? Math.round((value - prevVal) * 100) / 100 : null;
      const weekDiv    = dividendLog.filter((d) => d.week === week && d.team === name).reduce((s, d) => s + d.payout, 0);
      return {
        teamName: name, owned, idx,
        adjEM: t?.adjEM ?? 0, adjEMDelta: t?.adjEMDelta ?? null,
        price: t?.price ?? 0, priceDelta: t?.priceDelta ?? null,
        value, valueDelta, weekDiv,
        totalDivs: teamDividends[name] || 0,
        conf: t?.conference ?? "", record: t?.record ?? "",
      };
    }).sort((a, b) => b.value - a.value), [portfolio, teamsThisWeek, dividendLog, week, teamDividends]);

  const portfolioValueDelta = portfolioHistory.length >= 2
    ? Math.round((portfolioHistory[portfolioHistory.length - 1] - portfolioHistory[portfolioHistory.length - 2]) * 100) / 100
    : null;
  const weekDividendTotal = dividendLog.filter((d) => d.week === week).reduce((s, d) => s + d.payout, 0);
  const ownedCount        = Object.values(portfolio).reduce((s, v) => s + v, 0);

  // Chart labels aligned with portfolioHistory data points
  const chartLabels = ["Start", ...WEEKS.slice(0, portfolioHistory.length - 1)];

  // Team modal derived data
  const teamDetail = useMemo(() => {
    if (!selectedTeam) return null;
    const t = TEAM_HISTORY.find((t) => t.team === selectedTeam);
    if (!t) return null;
    const dataUpToNow = t.weeklyAdjEM.slice(0, week + 1);
    const allGames    = SCHEDULES[selectedTeam] || [];
    const pastGames   = allGames.filter((g) => g.week <= week);
    const futureGames = allGames.filter((g) => g.week > week);
    const tooltipRows = dataUpToNow.map((_, i) => {
      const wk = i + 1;
      const games = allGames.filter((g) => g.week === wk);
      if (!games.length) return null;
      return games.map((g) => {
        const loc = g.location === "H" ? "vs" : g.location === "A" ? "@" : "vs";
        return `${g.result} ${loc} ${g.opponent} ${g.score || ""}`;
      });
    });
    const earnedDivs = dividendLog.filter((d) => d.team === selectedTeam);
    return {
      ...t, dataUpToNow,
      last5: pastGames.slice(-5), next5: futureGames.slice(0, 5),
      tooltipRows, earnedDivs,
      hasSchedule: allGames.length > 0,
    };
  }, [selectedTeam, week, dividendLog, TEAM_HISTORY, SCHEDULES]);

  // ── Actions ────────────────────────────────────────────────────────────────

  async function buyShare(teamName) {
    const team = teamsThisWeek.find((t) => t.team === teamName);
    if (!team || buyingPower < team.price - 0.001) return;
    const owned = portfolio[teamName] || 0;
    if (owned >= team.shares || tradePending) return;

    setTradePending(true);
    setTradeError("");

    if (market?.id) {
      // Persist to DB
      try {
        const result = await buyShareDB(market.id, teamName, team.price, week);
        setPortfolio((p) => ({ ...p, [teamName]: result.newShares }));
        setCashBalance(result.newCashBalance);
        setTradeLog((l) => [{
          week, team: teamName, action: "BUY", qty: 1, price: team.price, total: team.price,
        }, ...l]);
      } catch (err) {
        console.error("[buyShare]", err.message);
        setTradeError("Purchase failed — " + err.message);
      } finally {
        setTradePending(false);
      }
    } else {
      // Demo mode: no market connected, local state only
      setPortfolio((p) => ({ ...p, [teamName]: (p[teamName] || 0) + 1 }));
      setCashBalance((c) => Math.round((c - team.price) * 100) / 100);
      setTradeLog((l) => [{
        week, team: teamName, action: "BUY", qty: 1, price: team.price, total: team.price,
      }, ...l]);
      setTradePending(false);
    }
  }

  async function sellShare(teamName) {
    const owned = portfolio[teamName] || 0;
    if (owned === 0 || tradePending) return;
    const team = teamsThisWeek.find((t) => t.team === teamName);
    if (!team) return;

    setTradePending(true);
    setTradeError("");

    if (market?.id) {
      try {
        const result = await sellShareDB(market.id, teamName, team.price, week);
        setPortfolio((p) => ({ ...p, [teamName]: result.newShares }));
        setCashBalance(result.newCashBalance);
        setTradeLog((l) => [{
          week, team: teamName, action: "SELL", qty: 1, price: team.price, total: team.price,
        }, ...l]);
      } catch (err) {
        console.error("[sellShare]", err.message);
        setTradeError("Sale failed — " + err.message);
      } finally {
        setTradePending(false);
      }
    } else {
      setPortfolio((p) => ({ ...p, [teamName]: p[teamName] - 1 }));
      setCashBalance((c) => Math.round((c + team.price) * 100) / 100);
      setTradeLog((l) => [{
        week, team: teamName, action: "SELL", qty: 1, price: team.price, total: team.price,
      }, ...l]);
      setTradePending(false);
    }
  }

  async function advanceWeek() {
    if (week >= WEEKS.length - 1 || tradePending) return;
    const nextWeek = week + 1;

    // 1. Compute dividends from static season data
    const weekEvents = EVENTS_BY_WEEK[nextWeek] || [];
    let weekDivTotal = 0;
    const dbDivRows  = [];
    const uiDivLogs  = [];

    for (const evt of weekEvents) {
      const owned = portfolio[evt.team] || 0;
      if (owned === 0) continue;
      const ruleKey = ruleKeyForEventLabel(evt.event);
      const baseVal = (ruleKey != null && dividendOverrides[ruleKey] != null)
        ? dividendOverrides[ruleKey]
        : evt.value;
      const payout = Math.round(baseVal * dividendMultiplier * owned * 100) / 100;
      weekDivTotal += payout;
      dbDivRows.push({
        teamId: evt.team, eventKey: ruleKey ?? evt.event, eventLabel: evt.event,
        sharesOwned: owned, baseValue: baseVal, multiplier: dividendMultiplier, payout,
      });
      uiDivLogs.push({
        week: nextWeek, team: evt.team, event: evt.event,
        baseValue: baseVal, multiplier: dividendMultiplier, sharesOwned: owned, payout,
      });
    }

    // 2. Compute updated values
    const newHoldingsValue = Object.entries(portfolio).reduce((sum, [name, owned]) => {
      const t = TEAM_HISTORY.find((t) => t.team === name);
      if (!t) return sum;
      const er = t.weeklyAdjEM[nextWeek];
      return sum + (er / calcShares(er)) * owned;
    }, 0);
    const newCashBalance = Math.round((cashBalance + weekDivTotal) * 100) / 100;
    const newDivsEarned  = Math.round((dividendsEarned + weekDivTotal) * 100) / 100;
    const newTotalValue  = Math.round((newHoldingsValue + newCashBalance) * 100) / 100;

    // 3. Write to DB (non-blocking — local state advances regardless)
    if (market?.id) {
      try {
        const dbWrites = [
          savePortfolioSnapshot(market.id, nextWeek, newTotalValue, newCashBalance),
          advanceMarketWeek(market.id, nextWeek),
          unlockPortfolios(market.id),
        ];
        if (weekDivTotal > 0) {
          dbWrites.push(saveDividendPayouts(market.id, nextWeek, dbDivRows));
          dbWrites.push(updateMemberFinancials(market.id, newCashBalance, weekDivTotal));
        }
        await Promise.all(dbWrites);
        setPortfolioLocked(false); // portfolios unlock when week advances
        refreshMarkets(); // update market.current_week in context
        loadLeaderboardFromDB(market.id);
        loadQueueFromDB(market.id, nextWeek); // new week = empty queue
      } catch (err) {
        console.error("[advanceWeek] DB write failed:", err.message);
        // Non-fatal — local state still advances
      }
    }

    // 4. Update local state
    setCashBalance(newCashBalance);
    setDividendsEarned(newDivsEarned);
    setDividendLog((l) => [...uiDivLogs.reverse(), ...l]);
    setPortfolioHistory((h) => [...h, newTotalValue]);
    setWeek(nextWeek);
  }

  async function loadQueueFromDB(marketId, currentWeek) {
    try {
      const requests = await getMyQueueRequests(marketId, currentWeek);
      setQueueRequests(requests);
    } catch (err) {
      console.warn("[GameLayout] loadQueue failed:", err.message);
    }
  }

  async function handleQueueBuy(teamName) {
    if (!market?.id || queueSubmitting) return;
    const team = teamsThisWeek.find((t) => t.team === teamName);
    if (!team) return;
    setQueueSubmitting(true);
    setQueueError("");
    try {
      await submitQueueRequest(market.id, week, "buy", teamName, team.price, team.shares);
      await loadQueueFromDB(market.id, week);
    } catch (err) {
      console.error("[handleQueueBuy]", err.message);
      setQueueError(err.message);
    } finally {
      setQueueSubmitting(false);
    }
  }

  async function handleQueueSell(teamName) {
    if (!market?.id || queueSubmitting) return;
    const team = teamsThisWeek.find((t) => t.team === teamName);
    if (!team) return;
    setQueueSubmitting(true);
    setQueueError("");
    try {
      await submitQueueRequest(market.id, week, "sell", teamName, team.price, team.shares);
      await loadQueueFromDB(market.id, week);
    } catch (err) {
      console.error("[handleQueueSell]", err.message);
      setQueueError(err.message);
    } finally {
      setQueueSubmitting(false);
    }
  }

  async function handleCancelRequest(requestId) {
    if (!market?.id || queueSubmitting) return;
    setQueueSubmitting(true);
    setQueueError("");
    try {
      await cancelQueueRequest(requestId);
      await loadQueueFromDB(market.id, week);
    } catch (err) {
      console.error("[handleCancelRequest]", err.message);
      setQueueError("Could not cancel request — " + err.message);
    } finally {
      setQueueSubmitting(false);
    }
  }

  async function loadLeaderboardFromDB(marketId) {
    setLeaderboardLoading(true);
    try {
      const entries = await getLeaderboard(marketId);
      setLeaderboard(entries);
    } catch (err) {
      console.warn("[GameLayout] loadLeaderboard failed:", err.message);
    } finally {
      setLeaderboardLoading(false);
    }
  }

  // Reload portfolio from DB (replaces old resetGame for multi-user play)
  function handleRefreshPortfolio() {
    if (!market?.id) return;
    loadPortfolioFromDB(market.id, startingBudget);
    loadLeaderboardFromDB(market.id);
    loadQueueFromDB(market.id, week);
  }

  function handleSort(col) {
    if (sortCol === col) setSortAsc((a) => !a);
    else { setSortCol(col); setSortAsc(col === "team" || col === "conference"); }
  }

  function handleChangeSeason(newId) {
    if (newId === seasonId) return;
    const newLabel = getSeason(newId).label;
    const ok = window.confirm(`Switch to ${newLabel}? This will reset your current local game state.`);
    if (!ok) return;
    setSeasonId(newId);
    setWeek(0);
    setPortfolio({});
    setCashBalance(startingBudget);
    setDividendsEarned(0);
    setTradeLog([]);
    setDividendLog([]);
    setSelectedTeam(null);
    setPortfolioHistory([startingBudget]);
  }

  async function handleLogout() {
    setLogoutError("");
    try {
      await signOut();
      navigate("/login", { replace: true });
    } catch (err) {
      console.error("Logout failed:", err.message);
      setLogoutError("Sign out failed — please try again.");
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="container">
      <div className="topbar">
        <div className="topbar-left">
          <h1 className="app-title">Folio</h1>
          <span className="week-badge">{WEEKS[week]}</span>
          {draftMode && <span className="status-pill sample">Draft day</span>}
        </div>
        <div className="topbar-right">
          <button className="tab-btn" onClick={() => navigate("/market")}>Market</button>
          <button className="tab-btn" onClick={() => navigate("/portfolio")}>
            My portfolio {ownedCount > 0 && <span className="badge">{ownedCount}</span>}
          </button>
          <button className="tab-btn" onClick={() => navigate("/log")}>Log</button>
          <button className="tab-btn" onClick={() => navigate("/draft")}>Draft</button>
          <button className="tab-btn" onClick={() => navigate("/admin")}>Admin</button>
          <button className="gear-btn" onClick={() => setShowSettings(true)} title="Settings" aria-label="Open settings">⚙</button>
          <button
            className="tab-btn signout-btn"
            onClick={handleLogout}
            title={`Sign out (${user?.email})`}
          >
            Sign out
          </button>
        </div>
      </div>

      {logoutError && (
        <div style={{ background: "#2e1a1a", border: "1px solid #4a2a2a", color: "#cf6f6f", borderRadius: "6px", padding: "0.5rem 0.85rem", fontSize: "0.85rem", marginBottom: "1rem" }}>
          {logoutError}
        </div>
      )}

      {tradeError && (
        <div style={{ background: "#2e1a1a", border: "1px solid #4a2a2a", color: "#cf6f6f", borderRadius: "6px", padding: "0.5rem 0.85rem", fontSize: "0.85rem", marginBottom: "1rem", display: "flex", alignItems: "center", gap: 8 }}>
          {tradeError}
          <button style={{ color: "#cf6f6f", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }} onClick={() => setTradeError("")}>Dismiss</button>
        </div>
      )}

      {queueError && (
        <div style={{ background: "#2e1a1a", border: "1px solid #4a2a2a", color: "#cf6f6f", borderRadius: "6px", padding: "0.5rem 0.85rem", fontSize: "0.85rem", marginBottom: "1rem", display: "flex", alignItems: "center", gap: 8 }}>
          {queueError}
          <button style={{ color: "#cf6f6f", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }} onClick={() => setQueueError("")}>Dismiss</button>
        </div>
      )}

      <div className="stat-bar">
        <div className="stat">
          <div className="stat-label">Buying power</div>
          <div className="stat-value">${buyingPower.toFixed(2)}</div>
          {dividendsEarned > 0 && (
            <div className="stat-sub">
              <span className="div-tag">incl. ${dividendsEarned.toFixed(2)} divs</span>
            </div>
          )}
        </div>
        <div className="stat">
          <div className="stat-label">Holdings value</div>
          <div className="stat-value">${holdingsValue.toFixed(2)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Dividends earned</div>
          <div className="stat-value dividend-blue">${dividendsEarned.toFixed(2)}</div>
          {weekDividendTotal > 0 && <span className="delta up">+${weekDividendTotal.toFixed(2)} this wk</span>}
        </div>
        <div className="stat">
          <div className={`stat-value ${gain >= 0 ? "positive" : "negative"}`}>{gain >= 0 ? "+" : ""}${gain.toFixed(2)}</div>
        </div>
      </div>

      {/* Market membership display */}
      {markets.length > 0 && (
        <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "#888", fontFamily: "Arial, sans-serif", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.4px" }}>
            Market:
          </span>
          {markets.length === 1 ? (
            <span style={{ fontSize: 13, fontFamily: "Arial, sans-serif", fontWeight: 600, color: "#0d1b2a" }}>
              {market?.name ?? "—"}
              {market?.status && (
                <span style={{
                  marginLeft: 8, fontSize: 11, fontWeight: 600, fontFamily: "Arial, sans-serif",
                  padding: "1px 8px", borderRadius: 20,
                  background: market.status === "active" ? "#EAF3DE" : market.status === "draft" ? "#FAEEDA" : market.status === "complete" ? "#E8F1FA" : "#f0ece4",
                  border: `1px solid ${market.status === "active" ? "#C0DD97" : market.status === "draft" ? "#FAC775" : market.status === "complete" ? "#A8C8F0" : "#d8d0c4"}`,
                  color: market.status === "active" ? "#3B6D11" : market.status === "draft" ? "#854F0B" : market.status === "complete" ? "#185FA5" : "#666",
                }}>
                  {market.status.charAt(0).toUpperCase() + market.status.slice(1)}
                </span>
              )}
            </span>
          ) : (
            <select
              value={market?.id ?? ""}
              onChange={(e) => setActiveMarketId(e.target.value)}
              style={{ fontSize: 13, padding: "3px 8px", borderRadius: 6, border: "1px solid #ddd", fontFamily: "Arial, sans-serif", color: "#0d1b2a", background: "#fff", cursor: "pointer" }}
            >
              {markets.map((m) => (
                <option key={m.id} value={m.id}>{m.name} ({m.status})</option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className="week-controls">
        <div className="week-track">
          {WEEKS.map((w, i) => (
            <div key={i} className={`week-pip ${i < week ? "done" : i === week ? "current" : ""}`} title={w} />
          ))}
        </div>
        <div className="week-actions">
          {week < WEEKS.length - 1
            ? <button className="advance-btn" onClick={advanceWeek} disabled={tradePending}>
                {draftMode ? "Lock in picks & start season →" : `Advance to ${WEEKS[week + 1]} →`}
              </button>
            : <span className="season-end-label">Season complete \U0001F3C6</span>}
          <button
            className="reset-btn"
            onClick={handleRefreshPortfolio}
            disabled={portfolioLoading || !market?.id}
            title="Reload portfolio from database"
          >
            {portfolioLoading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {portfolioLoading && (
        <div style={{ textAlign: "center", padding: "0.75rem", fontSize: 13, color: "#aaa", fontFamily: "Arial, sans-serif" }}>
          Loading portfolio…
        </div>
      )}

      {/* Route-based page views */}
      <Routes>
        <Route path="market" element={
          <>
            <Leaderboard
              entries={leaderboard}
              currentUserId={user?.id}
              loading={leaderboardLoading}
            />
            <QueuePanel
              requests={queueRequests}
              weekLabel={WEEKS[week] ?? `Week ${week}`}
              onCancel={handleCancelRequest}
              submitting={queueSubmitting}
              portfolioLocked={portfolioLocked}
            />
            <MarketTable
              filteredTeams={filteredTeams}
              totalTeams={TEAM_HISTORY.length}
              portfolio={portfolio}
              buyingPower={buyingPower}
              week={week}
              draftMode={draftMode}
              sortCol={sortCol}
              sortAsc={sortAsc}
              search={search}
              confFilter={confFilter}
              conferences={conferences}
              maxAdjEM={maxAdjEM}
              tradePending={tradePending}
              onSearch={setSearch}
              onConfFilter={setConfFilter}
              onSort={handleSort}
              onBuy={buyShare}
              onSell={sellShare}
              onSelectTeam={setSelectedTeam}
            />
          </>
        } />
        <Route path="portfolio" element={
          <PortfolioView
            portfolioRows={portfolioRows}
            portfolioHistory={portfolioHistory}
            portfolioValueDelta={portfolioValueDelta}
            chartLabels={chartLabels}
            pieSlices={pieSlices}
            pieTotal={pieTotal}
            holdingsValue={holdingsValue}
            dividendsEarned={dividendsEarned}
            weekDividendTotal={weekDividendTotal}
            dividendLog={dividendLog}
            tradeLog={tradeLog}
            week={week}
            weeks={WEEKS}
            teamsThisWeek={teamsThisWeek}
            buyingPower={buyingPower}
            tradePending={tradePending}
            buyShare={buyShare}
            sellShare={sellShare}
            onSelectTeam={setSelectedTeam}
            onGoToMarket={() => navigate("/market")}
          />
        } />
      </Routes>

      <p className="source-note">
        {seasonLabel} season &middot; {TEAM_HISTORY.length} D-I teams &middot; Price = Rating &divide; shares &middot; Budget: ${startingBudget}
        {dividendMultiplier !== 1 && <> &middot; Dividends &times;{dividendMultiplier}</>}
      </p>

      {/* Modals */}
      <TeamModal
        selectedTeam={selectedTeam}
        teamDetail={teamDetail}
        week={week}
        weeks={WEEKS}
        portfolio={portfolio}
        buyingPower={buyingPower}
        queueRequests={queueRequests}
        submitting={queueSubmitting}
        portfolioLocked={portfolioLocked}
        onQueueBuy={handleQueueBuy}
        onQueueSell={handleQueueSell}
        onCancelRequest={handleCancelRequest}
        onClose={() => setSelectedTeam(null)}
      />

      {showSettings && (
        <SettingsModal
          seasonId={seasonId}
          budget={budget}
          dividendMultiplier={dividendMultiplier}
          dividendOverrides={dividendOverrides}
          onChangeSeason={handleChangeSeason}
          onChangeBudget={setBudget}
          onChangeMultiplier={setDividendMultiplier}
          onChangeOverride={(key, value) => setDividendOverrides((o) => ({ ...o, [key]: value }))}
          onResetOverrides={() => setDividendOverrides(buildDefaultOverrides())}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

// Root router
function AuthRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return <Navigate to={user ? "/market" : "/login"} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AuthRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/join/:token" element={<ProtectedRoute><JoinPage /></ProtectedRoute>} />
      <Route path="/log"   element={<ProtectedRoute><LogPage /></ProtectedRoute>} />
      <Route path="/draft" element={<ProtectedRoute><DraftPage /></ProtectedRoute>} />
      <Route path="/admin" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
      <Route path="/*" element={<ProtectedRoute><GameLayout /></ProtectedRoute>} />
    </Routes>
  );
}
