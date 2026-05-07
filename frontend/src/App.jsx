import { useState, useMemo } from "react";
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
import ProtectedRoute from "./components/ProtectedRoute";
import MarketTable from "./components/MarketTable";
import PortfolioView from "./components/PortfolioView";
import TeamModal from "./components/TeamModal";
import SettingsModal from "./components/SettingsModal";
import LoginPage from "./pages/LoginPage";
import LogPage from "./pages/LogPage";
import DraftPage from "./pages/DraftPage";
import AdminPage from "./pages/AdminPage";
import "./App.css";

const DEFAULT_BUDGET     = 100;
const DEFAULT_MULTIPLIER = 1;

function buildDefaultOverrides() {
  return Object.fromEntries(DIVIDEND_RULES.map((r) => [r.key, r.value]));
}

// ── Market + Portfolio pages share all game state ─────────────────────────────
// State lives here so it survives navigation between /market and /portfolio.
function GameLayout() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  // Settings
  const [seasonId, setSeasonId]                     = useState(DEFAULT_SEASON_ID);
  const [budget, setBudget]                         = useState(DEFAULT_BUDGET);
  const [dividendMultiplier, setDividendMultiplier] = useState(DEFAULT_MULTIPLIER);
  const [dividendOverrides, setDividendOverrides]   = useState(buildDefaultOverrides);
  const [showSettings, setShowSettings]             = useState(false);
  const [logoutError, setLogoutError]               = useState("");

  const season = useMemo(() => getSeason(seasonId), [seasonId]);
  const { WEEKS, TEAM_HISTORY, SCHEDULES, EVENTS_BY_WEEK, label: seasonLabel } = season;

  // Game state
  const [week, setWeek]                           = useState(0);
  const [portfolio, setPortfolio]                 = useState({});
  const [cash, setCash]                           = useState(DEFAULT_BUDGET);
  const [dividendBank, setDividendBank]           = useState(0);
  const [draftMode, setDraftMode]                 = useState(true);
  const [search, setSearch]                       = useState("");
  const [confFilter, setConfFilter]               = useState("");
  const [sortCol, setSortCol]                     = useState("adjEM");
  const [sortAsc, setSortAsc]                     = useState(false);
  const [selectedTeam, setSelectedTeam]           = useState(null);
  const [tradeLog, setTradeLog]                   = useState([]);
  const [dividendLog, setDividendLog]             = useState([]);
  const [portfolioHistory, setPortfolioHistory]   = useState([DEFAULT_BUDGET]);
  const [teamDividends, setTeamDividends]         = useState({});

  const buyingPower = dividendBank + cash;

  // ── Derived data ───────────────────────────────────────────────────────────
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
      adjEMDelta:  prevAdjEM != null ? Math.round((adjEM - prevAdjEM) * 100) / 100 : null,
      priceDelta:  prevPrice != null ? Math.round((price - prevPrice) * 100) / 100 : null,
      record:      t.weeklyRecord[week],
    };
  }), [week, TEAM_HISTORY]);

  const holdingsValue = useMemo(() =>
    Object.entries(portfolio).reduce((sum, [name, owned]) => {
      const t = teamsThisWeek.find((t) => t.team === name);
      return t ? sum + t.price * owned : sum;
    }, 0), [portfolio, teamsThisWeek]);

  const totalValue = holdingsValue + cash + dividendBank;
  const gain       = totalValue - budget;

  const pieSlices = useMemo(() => {
    const slices = [];
    const totalCash = cash + dividendBank;
    if (totalCash > 0.005) slices.push({ label: "Cash & Dividends", value: totalCash, color: "#B0BEC5" });
    Object.entries(portfolio).filter(([, o]) => o > 0).forEach(([name, owned], idx) => {
      const t      = teamsThisWeek.find((t) => t.team === name);
      const posVal = t ? t.price * owned : 0;
      const divVal = teamDividends[name] || 0;
      const col    = teamColor(idx);
      if (posVal > 0.005) slices.push({ label: `${name} (value)`, value: posVal, color: col });
      if (divVal > 0.005) slices.push({ label: `${name} (divs)`,  value: divVal, color: col + "99" });
    });
    return slices;
  }, [cash, dividendBank, portfolio, teamsThisWeek, teamDividends]);
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
      return { teamName: name, owned, idx, adjEM: t?.adjEM ?? 0, adjEMDelta: t?.adjEMDelta ?? null, price: t?.price ?? 0, priceDelta: t?.priceDelta ?? null, value, valueDelta, weekDiv, totalDivs: teamDividends[name] || 0, conf: t?.conference ?? "", record: t?.record ?? "" };
    }).sort((a, b) => b.value - a.value), [portfolio, teamsThisWeek, dividendLog, week, teamDividends]);

  const portfolioValueDelta = portfolioHistory.length >= 2
    ? Math.round((portfolioHistory[portfolioHistory.length - 1] - portfolioHistory[portfolioHistory.length - 2]) * 100) / 100
    : null;
  const weekDividendTotal = dividendLog.filter((d) => d.week === week).reduce((s, d) => s + d.payout, 0);
  const ownedCount = Object.values(portfolio).reduce((s, v) => s + v, 0);

  // Team modal derived data
  const teamDetail = useMemo(() => {
    if (!selectedTeam) return null;
    const t = TEAM_HISTORY.find((t) => t.team === selectedTeam);
    if (!t) return null;
    const dataUpToNow  = t.weeklyAdjEM.slice(0, week + 1);
    const priceHistory = dataUpToNow.map((e) => Math.round((e / calcShares(e)) * 100) / 100);
    const allGames     = SCHEDULES[selectedTeam] || [];
    const hasSchedule  = allGames.length > 0;
    const pastGames    = allGames.filter((g) => g.week <= week);
    const futureGames  = allGames.filter((g) => g.week > week);
    const tooltipRows  = dataUpToNow.map((_, i) => {
      const wk = i + 1;
      const games = allGames.filter((g) => g.week === wk);
      if (!games.length) return null;
      return games.map((g) => {
        const loc = g.location === "H" ? "vs" : g.location === "A" ? "@" : "vs";
        return `${g.result} ${loc} ${g.opponent} ${g.score || ""}`;
      });
    });
    const earnedDivs = dividendLog.filter((d) => d.team === selectedTeam);
    return { ...t, dataUpToNow, priceHistory, last5: pastGames.slice(-5), next5: futureGames.slice(0, 5), tooltipRows, earnedDivs, hasSchedule };
  }, [selectedTeam, week, dividendLog, TEAM_HISTORY, SCHEDULES]);

  // ── Actions ────────────────────────────────────────────────────────────────
  function advanceWeek() {
    if (week >= WEEKS.length - 1) return;
    const nextWeek = week + 1;
    const newHoldings = Object.entries(portfolio).reduce((sum, [name, owned]) => {
      const t = TEAM_HISTORY.find((t) => t.team === name);
      if (!t) return sum;
      const adjEM = t.weeklyAdjEM[nextWeek];
      return sum + (adjEM / calcShares(adjEM)) * owned;
    }, 0);
    const weekEvents = EVENTS_BY_WEEK[nextWeek] || [];
    let newDivTotal = 0;
    const newDivLogs = [];
    const newTeamDivs = { ...teamDividends };
    for (const evt of weekEvents) {
      const owned = portfolio[evt.team] || 0;
      if (owned === 0) continue;
      const ruleKey = ruleKeyForEventLabel(evt.event);
      const baseVal = (ruleKey != null && dividendOverrides[ruleKey] != null)
        ? dividendOverrides[ruleKey]
        : evt.value;
      const payout = Math.round(baseVal * dividendMultiplier * owned * 100) / 100;
      newDivTotal += payout;
      newTeamDivs[evt.team] = Math.round(((newTeamDivs[evt.team] || 0) + payout) * 100) / 100;
      newDivLogs.push({ week: nextWeek, weekLabel: WEEKS[nextWeek], team: evt.team, event: evt.event, baseValue: baseVal, multiplier: dividendMultiplier, sharesOwned: owned, payout });
    }
    const newDivBank = Math.round((dividendBank + newDivTotal) * 100) / 100;
    setDividendBank(newDivBank);
    setTeamDividends(newTeamDivs);
    setDividendLog((l) => [...newDivLogs.reverse(), ...l]);
    setPortfolioHistory((h) => [...h, Math.round((newHoldings + cash + newDivBank) * 100) / 100]);
    setWeek(nextWeek);
    setDraftMode(false);
  }

  function buyShare(teamName) {
    const team = teamsThisWeek.find((t) => t.team === teamName);
    if (!team || buyingPower < team.price - 0.001) return;
    const owned = portfolio[teamName] || 0;
    if (owned >= team.shares) return;
    let remaining = team.price, newDivBank = dividendBank, newCash = cash;
    if (newDivBank >= remaining) { newDivBank = Math.round((newDivBank - remaining) * 100) / 100; remaining = 0; }
    else { remaining = Math.round((remaining - newDivBank) * 100) / 100; newDivBank = 0; newCash = Math.round((newCash - remaining) * 100) / 100; }
    setPortfolio((p) => ({ ...p, [teamName]: (p[teamName] || 0) + 1 }));
    setDividendBank(newDivBank);
    setCash(newCash);
    setTradeLog((l) => [{ week, weekLabel: WEEKS[week], team: teamName, action: "BUY", qty: 1, price: team.price, total: team.price }, ...l]);
  }

  function sellShare(teamName) {
    const owned = portfolio[teamName] || 0;
    if (owned === 0) return;
    const team = teamsThisWeek.find((t) => t.team === teamName);
    if (!team) return;
    setPortfolio((p) => ({ ...p, [teamName]: p[teamName] - 1 }));
    setCash((c) => Math.round((c + team.price) * 100) / 100);
    setTradeLog((l) => [{ week, weekLabel: WEEKS[week], team: teamName, action: "SELL", qty: 1, price: team.price, total: team.price }, ...l]);
  }

  function resetGame() {
    setWeek(0); setPortfolio({}); setCash(budget); setDividendBank(0);
    setTeamDividends({}); setDraftMode(true); setSearch(""); setConfFilter("");
    setTradeLog([]); setDividendLog([]); setSelectedTeam(null); setPortfolioHistory([budget]);
  }

  function handleSort(col) {
    if (sortCol === col) setSortAsc((a) => !a);
    else { setSortCol(col); setSortAsc(col === "team" || col === "conference"); }
  }

  function handleChangeSeason(newId) {
    if (newId === seasonId) return;
    const newLabel = getSeason(newId).label;
    const ok = window.confirm(`Switch to ${newLabel}? This will reset your current game.`);
    if (!ok) return;
    setSeasonId(newId);
    setWeek(0); setPortfolio({}); setCash(budget); setDividendBank(0);
    setTeamDividends({}); setDraftMode(true); setSearch(""); setConfFilter("");
    setTradeLog([]); setDividendLog([]); setSelectedTeam(null); setPortfolioHistory([budget]);
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

  // ── Shared top bar + week controls ────────────────────────────────────────
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

      <div className="stat-bar">
        <div className="stat">
          <div className="stat-label">Buying power</div>
          <div className="stat-value">${buyingPower.toFixed(2)}</div>
          <div className="stat-sub">
            <span className="cash-tag">${cash.toFixed(2)} cash</span>
            {dividendBank > 0 && <span className="div-tag">+${dividendBank.toFixed(2)} divs</span>}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Holdings value</div>
          <div className="stat-value">${holdingsValue.toFixed(2)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Dividends earned</div>
          <div className="stat-value dividend-blue">${dividendBank.toFixed(2)}</div>
          {weekDividendTotal > 0 && <span className="delta up">+${weekDividendTotal.toFixed(2)} this wk</span>}
        </div>
        <div className="stat">
          <div className="stat-label">Season gain/loss</div>
          <div className={`stat-value ${gain >= 0 ? "positive" : "negative"}`}>{gain >= 0 ? "+" : ""}${gain.toFixed(2)}</div>
        </div>
      </div>

      <div className="week-controls">
        <div className="week-track">
          {WEEKS.map((w, i) => (
            <div key={i} className={`week-pip ${i < week ? "done" : i === week ? "current" : ""}`} title={w} />
          ))}
        </div>
        <div className="week-actions">
          {week < WEEKS.length - 1
            ? <button className="advance-btn" onClick={advanceWeek}>{draftMode ? "Lock in picks & start season →" : `Advance to ${WEEKS[week + 1]} →`}</button>
            : <span className="season-end-label">Season complete 🏆</span>}
          <button className="reset-btn" onClick={resetGame}>Reset</button>
        </div>
      </div>

      {/* ── Route-based page views ───────────────────────────────────────── */}
      <Routes>
        <Route path="market" element={
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
            onSearch={setSearch}
            onConfFilter={setConfFilter}
            onSort={handleSort}
            onBuy={buyShare}
            onSell={sellShare}
            onSelectTeam={setSelectedTeam}
          />
        } />
        <Route path="portfolio" element={
          <PortfolioView
            portfolioRows={portfolioRows}
            portfolioHistory={portfolioHistory}
            portfolioValueDelta={portfolioValueDelta}
            pieSlices={pieSlices}
            pieTotal={pieTotal}
            holdingsValue={holdingsValue}
            dividendBank={dividendBank}
            weekDividendTotal={weekDividendTotal}
            dividendLog={dividendLog}
            tradeLog={tradeLog}
            week={week}
            weeks={WEEKS}
            teamsThisWeek={teamsThisWeek}
            buyingPower={buyingPower}
            buyShare={buyShare}
            sellShare={sellShare}
            onSelectTeam={setSelectedTeam}
            onGoToMarket={() => navigate("/market")}
          />
        } />
      </Routes>

      <p className="source-note">
        {seasonLabel} season · {TEAM_HISTORY.length} D-I teams · Price = AdjEM ÷ shares · Buying power = dividends + cash · Budget: ${budget}
        {dividendMultiplier !== 1 && <> · Dividends ×{dividendMultiplier}</>}
      </p>

      {/* Modals (global — visible on any game route) */}
      <TeamModal
        selectedTeam={selectedTeam}
        teamDetail={teamDetail}
        week={week}
        weeks={WEEKS}
        portfolio={portfolio}
        buyingPower={buyingPower}
        buyShare={buyShare}
        sellShare={sellShare}
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

// ── Root router ───────────────────────────────────────────────────────────────
// All game routes are wrapped in ProtectedRoute — unauthenticated users are
// redirected to /login. The root / redirect is handled by AuthRedirect so it
// can inspect auth state before choosing the destination.
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

      {/* Protected game routes */}
      <Route path="/log"   element={<ProtectedRoute><LogPage /></ProtectedRoute>} />
      <Route path="/draft" element={<ProtectedRoute><DraftPage /></ProtectedRoute>} />
      <Route path="/admin" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />

      {/* Market + portfolio share GameLayout (shared state + topbar) */}
      <Route path="/*" element={<ProtectedRoute><GameLayout /></ProtectedRoute>} />
    </Routes>
  );
}
