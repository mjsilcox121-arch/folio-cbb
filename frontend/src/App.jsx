import { useState, useMemo, useRef, useCallback } from "react";
import {
  SEASONS,
  getSeason,
  DEFAULT_SEASON_ID,
  DIVIDEND_RULES,
  ruleKeyForEventLabel,
} from "./seasons";
import "./App.css";

const DEFAULT_BUDGET = 100;
const DEFAULT_MULTIPLIER = 1;
const MIN_MULTIPLIER = 0.5;
const MAX_MULTIPLIER = 3;
const VIEW_MARKET    = "market";
const VIEW_PORTFOLIO = "portfolio";

// Build the default override map: every rule key → its base value.
function buildDefaultOverrides() {
  return Object.fromEntries(DIVIDEND_RULES.map((r) => [r.key, r.value]));
}

const TEAM_COLORS = [
  "#1D9E75","#185FA5","#D85A30","#8B4FC8","#C4960F",
  "#2E86AB","#A23B72","#3D9970","#FF6B6B","#4ECDC4",
  "#45B7D1","#96CEB4","#FFEAA7","#DDA0DD","#98D8C8",
  "#F7DC6F","#BB8FCE","#85C1E9","#F1948A","#82E0AA",
];
function teamColor(idx) { return TEAM_COLORS[idx % TEAM_COLORS.length]; }

function calcShares(adjEM) {
  if (!adjEM || adjEM <= 0) return 1;
  return Math.floor(adjEM / 10) + 1;
}
function sharePrice(adjEM) { return adjEM / calcShares(adjEM); }

// ── Delta badge ───────────────────────────────────────────────────────────────
function Delta({ value }) {
  if (value == null || value === 0) return <span className="delta neutral">—</span>;
  return (
    <span className={`delta ${value > 0 ? "up" : "down"}`}>
      {value > 0 ? "▲" : "▼"} {Math.abs(value).toFixed(2)}
    </span>
  );
}

// ── Pie chart ─────────────────────────────────────────────────────────────────
function PieChart({ slices, size = 200 }) {
  const total = slices.reduce((s, sl) => s + sl.value, 0);
  const [hovered, setHovered] = useState(null);
  if (total <= 0) return <div className="pie-empty">No data yet.</div>;
  const cx = size / 2, cy = size / 2, r = size / 2 - 8, ri = r * 0.48;
  let angle = -Math.PI / 2;
  const paths = slices.map((sl, i) => {
    const sweep = (sl.value / total) * 2 * Math.PI;
    const a1 = angle, a2 = angle + sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const ox1 = cx + r * Math.cos(a1), oy1 = cy + r * Math.sin(a1);
    const ox2 = cx + r * Math.cos(a2), oy2 = cy + r * Math.sin(a2);
    const ix1 = cx + ri * Math.cos(a2), iy1 = cy + ri * Math.sin(a2);
    const ix2 = cx + ri * Math.cos(a1), iy2 = cy + ri * Math.sin(a1);
    const d = `M ${ox1} ${oy1} A ${r} ${r} 0 ${large} 1 ${ox2} ${oy2} L ${ix1} ${iy1} A ${ri} ${ri} 0 ${large} 0 ${ix2} ${iy2} Z`;
    angle = a2;
    return { d, color: sl.color, label: sl.label, value: sl.value, pct: ((sl.value / total) * 100).toFixed(1), i };
  });
  const hov = hovered != null ? slices[hovered] : null;
  return (
    <div className="pie-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: "visible" }}>
        {paths.map((p) => (
          <path key={p.i} d={p.d} fill={p.color} stroke="#fff" strokeWidth="2"
            style={{ transform: hovered === p.i ? `scale(1.04)` : "scale(1)", transformOrigin: `${cx}px ${cy}px`, transition: "transform 0.15s", cursor: "pointer" }}
            onMouseEnter={() => setHovered(p.i)} onMouseLeave={() => setHovered(null)} />
        ))}
        <text x={cx} y={cy - 10} textAnchor="middle" fontSize="11" fill="#888" fontFamily="Arial">{hov ? hov.label : "Total"}</text>
        <text x={cx} y={cy + 8}  textAnchor="middle" fontSize="15" fill="#0d1b2a" fontFamily="Arial" fontWeight="700">
          {hov ? `$${hov.value.toFixed(2)}` : `$${total.toFixed(2)}`}
        </text>
        {hov && <text x={cx} y={cy + 24} textAnchor="middle" fontSize="11" fill="#aaa" fontFamily="Arial">{hov.pct}%</text>}
      </svg>
    </div>
  );
}

function PieLegend({ slices, total }) {
  return (
    <div className="pie-legend">
      {slices.map((sl, i) => (
        <div key={i} className="legend-row">
          <span className="legend-dot" style={{ background: sl.color }} />
          <span className="legend-label">{sl.label}</span>
          <span className="legend-pct">{((sl.value / total) * 100).toFixed(1)}%</span>
          <span className="legend-val">${sl.value.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Interactive SVG line chart with hover tooltip ─────────────────────────────
function LineChart({ data, labels, color = "#1D9E75", height = 120, currentIdx = null, tooltipRows = null }) {
  // tooltipRows: array of strings per data point (shown on hover)
  const [hovIdx, setHovIdx] = useState(null);
  const svgRef = useRef(null);

  if (!data || data.length < 2) return null;
  const W = 560, H = height;
  const pad = { top: 10, right: 10, bottom: 24, left: 44 };
  const iw = W - pad.left - pad.right, ih = H - pad.top - pad.bottom;
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const px = (i) => pad.left + (i / (data.length - 1)) * iw;
  const py = (v) => pad.top + ih - ((v - min) / range) * ih;
  const pts = data.map((v, i) => `${px(i)},${py(v)}`).join(" ");
  const area = `${px(0)},${pad.top + ih} ${pts} ${px(data.length - 1)},${pad.top + ih}`;
  const yT = Array.from({ length: 5 }, (_, i) => min + (range * i) / 4);
  const step = Math.max(1, Math.floor(data.length / 5));
  const xIdx = data.map((_, i) => (i % step === 0 || i === data.length - 1) ? i : null).filter(i => i !== null);
  const gid = `g${color.replace(/\W/g, "")}${height}`;

  // Hover hit areas
  const hitW = iw / (data.length - 1);

  const handleMouseMove = useCallback((e) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const relX = (e.clientX - rect.left) * (W / rect.width) - pad.left;
    const idx = Math.round(relX / (iw / (data.length - 1)));
    if (idx >= 0 && idx < data.length) setHovIdx(idx);
    else setHovIdx(null);
  }, [data.length, iw]);

  // Always show a tooltip on hover. If no schedule data was passed for this
  // week, fall back to just the value of the hovered point so the chart is
  // still informative.
  const rawTip = hovIdx != null ? tooltipRows?.[hovIdx] : null;
  let tooltipLines = null;
  if (hovIdx != null) {
    if (Array.isArray(rawTip) && rawTip.length > 0) tooltipLines = rawTip;
    else if (typeof rawTip === "string" && rawTip) tooltipLines = [rawTip];
    else tooltipLines = [`Value: ${data[hovIdx].toFixed(2)}`];
  }
  const txRaw = hovIdx != null ? px(hovIdx) : 0;
  const tooltipW = 170;
  const tx = Math.min(Math.max(txRaw - tooltipW / 2, pad.left), W - tooltipW - 4);
  const tyBase = hovIdx != null ? py(data[hovIdx]) : 0;
  const tooltipH = tooltipLines ? 18 + tooltipLines.length * 16 : 0;
  const ty = tyBase - tooltipH - 12 < pad.top ? tyBase + 14 : tyBase - tooltipH - 12;

  return (
    <div style={{ position: "relative" }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block", cursor: "crosshair" }}
        onMouseMove={handleMouseMove} onMouseLeave={() => setHovIdx(null)}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.15" />
            <stop offset="100%" stopColor={color} stopOpacity="0.01" />
          </linearGradient>
        </defs>
        <polygon points={area} fill={`url(#${gid})`} />
        {yT.map((t, i) => (
          <g key={i}>
            <line x1={pad.left} y1={py(t)} x2={pad.left + iw} y2={py(t)} stroke="#e8e4dc" strokeWidth="1" />
            <text x={pad.left - 6} y={py(t) + 4} textAnchor="end" fontSize="10" fill="#aaa">{t.toFixed(1)}</text>
          </g>
        ))}
        {xIdx.map((i) => (
          <text key={i} x={px(i)} y={H - 4} textAnchor="middle" fontSize="10" fill="#aaa">
            {labels?.[i]?.replace("Week ", "W").split(" ")[0] ?? `W${i + 1}`}
          </text>
        ))}
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {data.map((v, i) => (
          <circle key={i} cx={px(i)} cy={py(v)}
            r={i === hovIdx ? 6 : i === currentIdx ? 4.5 : 2.5}
            fill={i === hovIdx ? color : i === currentIdx ? color : "#fff"}
            stroke={color} strokeWidth="1.5" style={{ transition: "r 0.1s" }} />
        ))}
        {/* Hover vertical line */}
        {hovIdx != null && (
          <line x1={px(hovIdx)} y1={pad.top} x2={px(hovIdx)} y2={pad.top + ih}
            stroke={color} strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
        )}
        {/* Tooltip box */}
        {tooltipLines && hovIdx != null && (
          <g>
            <rect x={tx} y={ty} width={tooltipW} height={tooltipH} rx="5" ry="5"
              fill="#0d1b2a" opacity="0.88" />
            <text x={tx + 8} y={ty + 13} fontSize="10" fill="#aaa" fontFamily="Arial">
              {labels?.[hovIdx] ?? `W${hovIdx + 1}`}
            </text>
            {tooltipLines.map((line, li) => (
              <text key={li} x={tx + 8} y={ty + 13 + (li + 1) * 16} fontSize="11" fill="#fff" fontFamily="Arial">{line}</text>
            ))}
          </g>
        )}
      </svg>
    </div>
  );
}

// ── Game result row ───────────────────────────────────────────────────────────
function GameRow({ game, showAdjEM = false }) {
  const isWin = game.result === "W";
  const locLabel = game.location === "H" ? "vs" : game.location === "A" ? "@" : "vs";
  return (
    <div className={`game-row ${isWin ? "game-win" : "game-loss"}`}>
      <span className={`game-result-badge ${isWin ? "win" : "loss"}`}>{game.result}</span>
      <span className="game-opponent">
        <span className="game-loc">{locLabel}</span> {game.opponent}
        {showAdjEM && <span className="game-adjEM"> ({game.opponentAdjEM > 0 ? "+" : ""}{game.opponentAdjEM.toFixed(1)} AdjEM)</span>}
      </span>
      <span className="game-score">{game.score || ""}</span>
    </div>
  );
}

// ── Upcoming game row (no result) ─────────────────────────────────────────────
function UpcomingGameRow({ game, weeks }) {
  const locLabel = game.location === "H" ? "vs" : game.location === "A" ? "@" : "vs";
  const strength = game.opponentAdjEM >= 25 ? "elite" : game.opponentAdjEM >= 18 ? "strong" : game.opponentAdjEM >= 12 ? "mid" : "weak";
  return (
    <div className="game-row upcoming">
      <span className={`opp-strength ${strength}`}>{strength.toUpperCase()}</span>
      <span className="game-opponent">
        <span className="game-loc">{locLabel}</span> {game.opponent}
        <span className="game-adjEM"> (+{game.opponentAdjEM.toFixed(1)} AdjEM)</span>
      </span>
      <span className="game-week-label">{weeks?.[game.week - 1]?.split(" ")[0] ?? `W${game.week}`}</span>
    </div>
  );
}

// ── Settings modal ─────────────────────────────────────────────────────────
function SettingsModal({
  seasonId,
  budget,
  dividendMultiplier,
  dividendOverrides,
  onChangeSeason,
  onChangeBudget,
  onChangeMultiplier,
  onChangeOverride,
  onResetOverrides,
  onClose,
}) {
  const [budgetInput, setBudgetInput] = useState(String(budget));

  // Commit budget on blur or Enter so the user can type freely.
  function commitBudget() {
    const n = Number(budgetInput);
    if (!Number.isFinite(n) || n <= 0) {
      setBudgetInput(String(budget));
      return;
    }
    const clamped = Math.max(1, Math.min(10000, Math.round(n)));
    if (clamped !== budget) onChangeBudget(clamped);
    setBudgetInput(String(clamped));
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-team">⚙ Settings</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* ── Season ─────────────────────────────────────────────────────── */}
        <div className="settings-section">
          <label className="settings-label">Season</label>
          <p className="settings-help">Switching seasons resets your game.</p>
          <select
            className="settings-select"
            value={seasonId}
            onChange={(e) => onChangeSeason(e.target.value)}
          >
            {SEASONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} — Champion: {s.champion}
              </option>
            ))}
          </select>
        </div>

        {/* ── Starting budget ────────────────────────────────────────────── */}
        <div className="settings-section">
          <label className="settings-label" htmlFor="settings-budget">Starting budget ($)</label>
          <p className="settings-help">Applied on the next reset.</p>
          <input
            id="settings-budget"
            type="number"
            min="1"
            max="10000"
            className="settings-input"
            value={budgetInput}
            onChange={(e) => setBudgetInput(e.target.value)}
            onBlur={commitBudget}
            onKeyDown={(e) => { if (e.key === "Enter") commitBudget(); }}
          />
        </div>

        {/* ── Dividend multiplier ────────────────────────────────────────── */}
        <div className="settings-section">
          <label className="settings-label" htmlFor="settings-mult">
            Dividend multiplier <span className="settings-pill">×{dividendMultiplier.toFixed(2)}</span>
          </label>
          <p className="settings-help">Scales every dividend payout. Takes effect from the next week advance onward.</p>
          <input
            id="settings-mult"
            type="range"
            min={MIN_MULTIPLIER}
            max={MAX_MULTIPLIER}
            step="0.05"
            value={dividendMultiplier}
            onChange={(e) => onChangeMultiplier(Number(e.target.value))}
            className="settings-slider"
          />
          <div className="settings-slider-ticks">
            <span>{MIN_MULTIPLIER}×</span>
            <span>1×</span>
            <span>{MAX_MULTIPLIER}×</span>
          </div>
        </div>

        {/* ── Dividend rule amounts ──────────────────────────────────────── */}
        <div className="settings-section">
          <div className="settings-row-between">
            <label className="settings-label">Dividend amounts</label>
            <button className="settings-reset-btn" onClick={onResetOverrides}>Reset to defaults</button>
          </div>
          <p className="settings-help">Base value paid per share owned for each event type. Multiplier applies on top.</p>
          <div className="settings-rules-table">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Default</th>
                  <th>Override</th>
                </tr>
              </thead>
              <tbody>
                {DIVIDEND_RULES.map((r) => {
                  const cur = dividendOverrides[r.key] ?? r.value;
                  const isCustom = cur !== r.value;
                  return (
                    <tr key={r.key} className={isCustom ? "rule-custom" : ""}>
                      <td>{r.label}</td>
                      <td className="rule-default">${r.value}</td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          className="rule-input"
                          value={cur}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (Number.isFinite(n) && n >= 0) onChangeOverride(r.key, n);
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

        <div className="modal-actions">
          <button className="buy-btn large" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

// ── Buy/Sell controls inside the team modal ───────────────────────────────
function ModalActions({ teamDetail, week, selectedTeam, portfolio, buyingPower, buyShare, sellShare }) {
  const adjEM       = teamDetail.weeklyAdjEM[week];
  const totalShares = calcShares(adjEM);
  const ownedNow    = portfolio[selectedTeam] || 0;
  const atMax       = ownedNow >= totalShares;
  const priceNow    = Math.round(sharePrice(adjEM) * 100) / 100;
  const cantAfford  = buyingPower < priceNow - 0.001;
  const buyDisabled = atMax || cantAfford;
  const buyLabel    = atMax ? `All ${totalShares} shares owned` : `Buy — $${priceNow.toFixed(2)}`;
  return (
    <div className="modal-actions">
      <button
        className="buy-btn large"
        onClick={() => buyShare(selectedTeam)}
        disabled={buyDisabled}
        title={atMax ? `All ${totalShares} shares owned` : undefined}
      >
        {buyLabel}
      </button>
      <button className="sell-btn large" onClick={() => sellShare(selectedTeam)} disabled={!ownedNow}>
        Sell share
      </button>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  // ── Settings (persist across sessions via localStorage) ──────────────────
  const [seasonId, setSeasonId]                 = useState(DEFAULT_SEASON_ID);
  const [budget, setBudget]                     = useState(DEFAULT_BUDGET);
  const [dividendMultiplier, setDividendMultiplier] = useState(DEFAULT_MULTIPLIER);
  const [dividendOverrides, setDividendOverrides]   = useState(buildDefaultOverrides);
  const [showSettings, setShowSettings]         = useState(false);

  // Active season — derived from seasonId.
  const season = useMemo(() => getSeason(seasonId), [seasonId]);
  const { WEEKS, TEAM_HISTORY, SCHEDULES, EVENTS_BY_WEEK, label: seasonLabel } = season;

  const [view, setView]                 = useState(VIEW_MARKET);
  const [week, setWeek]                 = useState(0);
  const [portfolio, setPortfolio]       = useState({});
  const [cash, setCash]                 = useState(DEFAULT_BUDGET);
  const [dividendBank, setDividendBank] = useState(0);
  const [draftMode, setDraftMode]       = useState(true);
  const [search, setSearch]             = useState("");
  const [confFilter, setConfFilter]     = useState("");
  const [sortCol, setSortCol]           = useState("adjEM");
  const [sortAsc, setSortAsc]           = useState(false);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [tradeLog, setTradeLog]         = useState([]);
  const [dividendLog, setDividendLog]   = useState([]);
  const [portfolioHistory, setPortfolioHistory] = useState([DEFAULT_BUDGET]);
  const [teamDividends, setTeamDividends] = useState({});

  const buyingPower = dividendBank + cash;

  const teamsThisWeek = useMemo(() => TEAM_HISTORY.map((t) => {
    const adjEM     = t.weeklyAdjEM[week];
    const prevAdjEM = week > 0 ? t.weeklyAdjEM[week - 1] : null;
    const shares    = calcShares(adjEM);
    // Round price to 2 decimals so display/payment/holdings all use the same
    // value (avoids -0.01 drift after many trades).
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
  }), [week]);

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
      // Look up the configured base value via the rule key, falling back to the
      // event's literal value if no rule matches.
      const ruleKey  = ruleKeyForEventLabel(evt.event);
      const baseVal  = (ruleKey != null && dividendOverrides[ruleKey] != null)
        ? dividendOverrides[ruleKey]
        : evt.value;
      const payout   = Math.round(baseVal * dividendMultiplier * owned * 100) / 100;
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
    // Cap holdings at the team's total share count.
    const owned = portfolio[teamName] || 0;
    if (owned >= team.shares) return;
    let remaining = team.price, newDivBank = dividendBank, newCash = cash;
    if (newDivBank >= remaining) { newDivBank = Math.round((newDivBank - remaining) * 100) / 100; remaining = 0; }
    else { remaining = Math.round((remaining - newDivBank) * 100) / 100; newDivBank = 0; newCash = Math.round((newCash - remaining) * 100) / 100; }
    setPortfolio((p) => ({ ...p, [teamName]: (p[teamName] || 0) + 1 }));
    setDividendBank(newDivBank); setCash(newCash);
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
    setTeamDividends({}); setDraftMode(true); setView(VIEW_MARKET); setSearch("");
    setTradeLog([]); setDividendLog([]); setSelectedTeam(null); setPortfolioHistory([budget]);
  }

  function handleSort(col) {
    if (sortCol === col) setSortAsc((a) => !a);
    else { setSortCol(col); setSortAsc(col === "team" || col === "conference"); }
  }
  function arrow(col) {
    if (sortCol !== col) return null;
    return <span className="sort-arrow">{sortAsc ? "▲" : "▼"}</span>;
  }

  const conferences = useMemo(() => [...new Set(TEAM_HISTORY.map((t) => t.conference))].sort(), []);
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
    ? Math.round((portfolioHistory[portfolioHistory.length - 1] - portfolioHistory[portfolioHistory.length - 2]) * 100) / 100 : null;
  const weekDividendTotal = dividendLog.filter((d) => d.week === week).reduce((s, d) => s + d.payout, 0);
  const ownedCount = Object.values(portfolio).reduce((s, v) => s + v, 0);

  // ── Team modal data ────────────────────────────────────────────────────────
  const teamDetail = useMemo(() => {
    if (!selectedTeam) return null;
    const t = TEAM_HISTORY.find((t) => t.team === selectedTeam);
    if (!t) return null;
    const dataUpToNow    = t.weeklyAdjEM.slice(0, week + 1);
    const priceHistory   = dataUpToNow.map((e) => Math.round((e / calcShares(e)) * 100) / 100);
    const allGames       = SCHEDULES[selectedTeam] || [];
    const hasSchedule    = allGames.length > 0;
    const pastGames      = allGames.filter((g) => g.week <= week);
    const futureGames    = allGames.filter((g) => g.week > week);
    const last5          = pastGames.slice(-5);
    const next5          = futureGames.slice(0, 5);

    // Tooltip rows per week point: list of game results that week
    const tooltipRows = dataUpToNow.map((_, i) => {
      const wk = i + 1;
      const games = allGames.filter((g) => g.week === wk);
      if (!games.length) return null;
      return games.map((g) => {
        const loc = g.location === "H" ? "vs" : g.location === "A" ? "@" : "vs";
        return `${g.result} ${loc} ${g.opponent} ${g.score || ""}`;
      });
    });

    // Past dividends only (no future)
    const earnedDivs = dividendLog.filter((d) => d.team === selectedTeam);

    return { ...t, dataUpToNow, priceHistory, last5, next5, tooltipRows, earnedDivs, hasSchedule };
  }, [selectedTeam, week, dividendLog]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="container">
      <div className="topbar">
        <div className="topbar-left">
          <h1 className="app-title">KenPom Portfolio</h1>
          <span className="week-badge">{WEEKS[week]}</span>
          {draftMode && <span className="status-pill sample">Draft day</span>}
        </div>
        <div className="topbar-right">
          <button className={`tab-btn ${view === VIEW_MARKET ? "active" : ""}`} onClick={() => setView(VIEW_MARKET)}>Market</button>
          <button className={`tab-btn ${view === VIEW_PORTFOLIO ? "active" : ""}`} onClick={() => setView(VIEW_PORTFOLIO)}>
            My portfolio {ownedCount > 0 && <span className="badge">{ownedCount}</span>}
          </button>
          <button
            className="gear-btn"
            onClick={() => setShowSettings(true)}
            title="Settings"
            aria-label="Open settings"
          >⚙</button>
        </div>
      </div>

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
          {portfolioValueDelta != null && <Delta value={portfolioValueDelta} />}
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

      {/* ══ MARKET ═══════════════════════════════════════════════════════════ */}
      {view === VIEW_MARKET && (
        <>
          <div className="controls">
            <input type="text" placeholder={`Search all ${TEAM_HISTORY.length} teams...`} value={search} onChange={(e) => setSearch(e.target.value)} />
            <select value={confFilter} onChange={(e) => setConfFilter(e.target.value)}>
              <option value="">All conferences ({conferences.length})</option>
              {conferences.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {draftMode
              ? <div className="draft-hint">Draft mode — buying power: <strong>${buyingPower.toFixed(2)}</strong></div>
              : <div className="draft-hint live-hint">In-season — buying power: <strong>${buyingPower.toFixed(2)}</strong> (divs first)</div>}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th onClick={() => handleSort("team")}>Team {arrow("team")}</th>
                  <th onClick={() => handleSort("conference")}>Conf {arrow("conference")}</th>
                  <th onClick={() => handleSort("record")}>Record {arrow("record")}</th>
                  <th onClick={() => handleSort("adjEM")}>AdjEM {arrow("adjEM")}</th>
                  <th onClick={() => handleSort("adjEMDelta")}>AdjEM Chg {arrow("adjEMDelta")}</th>
                  <th onClick={() => handleSort("shares")}>Shares {arrow("shares")}</th>
                  <th onClick={() => handleSort("price")}>Price {arrow("price")}</th>
                  <th onClick={() => handleSort("priceDelta")}>Price Chg {arrow("priceDelta")}</th>
                  <th>Owned</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredTeams.map((t) => {
                  const owned  = portfolio[t.team] || 0;
                  const atMax  = owned >= t.shares;
                  const canBuy = !atMax && buyingPower >= t.price - 0.001;
                  const pct    = ((t.adjEM / maxAdjEM) * 100).toFixed(1);
                  return (
                    <tr key={t.team} className={owned > 0 ? "owned-row" : ""}>
                      <td><button className="team-link" onClick={() => setSelectedTeam(t.team)}>{t.team}</button></td>
                      <td><span className="conf-badge">{t.conference}</span></td>
                      <td className="record">{t.record}</td>
                      <td>
                        <div className="bar-cell">
                          <span className="adjEM positive">+{t.adjEM.toFixed(2)}</span>
                          <div className="bar-bg"><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
                        </div>
                      </td>
                      <td>{week > 0 ? <Delta value={t.adjEMDelta} /> : <span className="delta neutral">—</span>}</td>
                      <td>
                        <div className="shares-cell">
                          <span className="shares-count">{t.shares}</span>
                          <div className="shares-pips">{Array.from({ length: Math.min(t.shares, 6) }).map((_, i) => <span key={i} className="pip" />)}</div>
                        </div>
                      </td>
                      <td className="price-cell">${t.price.toFixed(2)}</td>
                      <td>{week > 0 ? <Delta value={t.priceDelta} /> : <span className="delta neutral">—</span>}</td>
                      <td>{owned > 0 ? <span className="owned-badge">{owned}{atMax && "/" + t.shares}</span> : <span className="owned-zero">—</span>}</td>
                      <td>
                        <div className="action-btns">
                          <button
                            className="buy-btn"
                            onClick={() => buyShare(t.team)}
                            disabled={!canBuy}
                            title={atMax ? `All ${t.shares} shares owned` : undefined}
                          >Buy</button>
                          <button className="sell-btn" onClick={() => sellShare(t.team)} disabled={owned === 0}>Sell</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="source-note">{filteredTeams.length} of {TEAM_HISTORY.length} teams · Click team name for team sheet</p>
        </>
      )}

      {/* ══ PORTFOLIO ════════════════════════════════════════════════════════ */}
      {view === VIEW_PORTFOLIO && (
        <>
          <div className="portfolio-top-row">
            <div className="chart-card flex-grow">
              {portfolioHistory.length > 1 ? (
                <>
                  <div className="chart-title">Portfolio value over time {portfolioValueDelta != null && <Delta value={portfolioValueDelta} />}</div>
                  <LineChart data={portfolioHistory} labels={["Start", ...WEEKS]} color="#1D9E75" height={160} currentIdx={portfolioHistory.length - 1} />
                </>
              ) : <div className="chart-placeholder">Advance through weeks to see your portfolio chart.</div>}
            </div>
            <div className="chart-card pie-card">
              <div className="chart-title">Portfolio composition</div>
              {pieSlices.length > 0 ? <><PieChart slices={pieSlices} size={200} /><PieLegend slices={pieSlices} total={pieTotal} /></> : <div className="pie-empty">Buy shares to see composition.</div>}
            </div>
          </div>

          {week > 0 && (portfolioValueDelta != null || weekDividendTotal > 0) && (
            <div className="week-summary-banner">
              <strong>{WEEKS[week]}</strong>
              {portfolioValueDelta != null && <span>Total Δ: <Delta value={portfolioValueDelta} /></span>}
              {weekDividendTotal > 0 && <span className="div-banner-earned">🏀 Dividends: <strong>+${weekDividendTotal.toFixed(2)}</strong> ({dividendLog.filter((d) => d.week === week).length} events)</span>}
            </div>
          )}

          {portfolioRows.length === 0 ? (
            <div className="empty-portfolio"><p>Your portfolio is empty.</p><p>Go to the <button className="link-btn" onClick={() => setView(VIEW_MARKET)}>Market</button> to buy shares.</p></div>
          ) : (
            <div className="table-wrap" style={{ marginBottom: "1.5rem" }}>
              <table>
                <thead>
                  <tr><th>Team</th><th>Conf</th><th>AdjEM</th><th>AdjEM Chg</th><th>Price</th><th>Price Chg</th><th>Owned</th><th>Position $</th><th>Pos Chg</th><th>Divs (wk)</th><th>Divs (total)</th><th>Action</th></tr>
                </thead>
                <tbody>
                  {portfolioRows.map((row) => (
                    <tr key={row.teamName}>
                      <td><div style={{ display:"flex", alignItems:"center", gap:6 }}><span className="team-color-dot" style={{ background: teamColor(row.idx) }} /><button className="team-link" onClick={() => setSelectedTeam(row.teamName)}>{row.teamName}</button></div></td>
                      <td><span className="conf-badge">{row.conf}</span></td>
                      <td className="adjEM positive">+{row.adjEM.toFixed(2)}</td>
                      <td>{week > 0 ? <Delta value={row.adjEMDelta} /> : <span className="delta neutral">—</span>}</td>
                      <td className="price-cell">${row.price.toFixed(2)}</td>
                      <td>{week > 0 ? <Delta value={row.priceDelta} /> : <span className="delta neutral">—</span>}</td>
                      <td><span className="shares-count">{row.owned}</span></td>
                      <td className="position-value">${row.value.toFixed(2)}</td>
                      <td>{week > 0 ? <Delta value={row.valueDelta} /> : <span className="delta neutral">—</span>}</td>
                      <td>{row.weekDiv > 0 ? <span className="div-earned">+${row.weekDiv.toFixed(2)}</span> : <span className="owned-zero">—</span>}</td>
                      <td>{row.totalDivs > 0 ? <span className="div-earned">${row.totalDivs.toFixed(2)}</span> : <span className="owned-zero">—</span>}</td>
                      <td><div className="action-btns"><button className="buy-btn" onClick={() => buyShare(row.teamName)} disabled={buyingPower < row.price - 0.001 || row.owned >= (teamsThisWeek.find((t) => t.team === row.teamName)?.shares ?? Infinity)}>Buy</button><button className="sell-btn" onClick={() => sellShare(row.teamName)}>Sell</button></div></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="totals-row">
                    <td colSpan={7}></td>
                    <td className="position-value totals-value">${holdingsValue.toFixed(2)}</td>
                    <td>{portfolioValueDelta != null && week > 0 && <Delta value={portfolioValueDelta} />}</td>
                    <td className="div-earned totals-value">{weekDividendTotal > 0 ? `+$${weekDividendTotal.toFixed(2)}` : "—"}</td>
                    <td className="div-earned totals-value">${dividendBank.toFixed(2)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <div className="section-title">Dividend history {dividendBank > 0 && <span className="div-total-pill">${dividendBank.toFixed(2)} available</span>}</div>
          {dividendLog.length === 0 ? <div className="empty-log">No dividends yet.</div> : (
            <div className="table-wrap" style={{ marginBottom: "1.5rem" }}>
              <table>
                <thead><tr><th>Week</th><th>Team</th><th>Event</th><th>Base</th><th>Shares</th><th>Payout</th></tr></thead>
                <tbody>
                  {dividendLog.map((d, i) => (
                    <tr key={i} className={d.week === week ? "new-div-row" : ""}>
                      <td className="record">{d.weekLabel}</td>
                      <td><button className="team-link" onClick={() => setSelectedTeam(d.team)}>{d.team}</button></td>
                      <td><span className="event-label">{d.event}</span></td>
                      <td className="price-cell">+${d.baseValue}</td>
                      <td><span className="shares-count">{d.sharesOwned}</span></td>
                      <td className="div-earned">+${d.payout.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="section-title">Trade history</div>
          {tradeLog.length === 0 ? <div className="empty-log">No trades yet.</div> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Week</th><th>Team</th><th>Action</th><th>Qty</th><th>Price/share</th><th>Cash impact</th></tr></thead>
                <tbody>
                  {tradeLog.map((t, i) => (
                    <tr key={i}>
                      <td className="record">{t.weekLabel}</td>
                      <td><button className="team-link" onClick={() => setSelectedTeam(t.team)}>{t.team}</button></td>
                      <td><span className={`action-pill ${t.action.toLowerCase()}`}>{t.action}</span></td>
                      <td>{t.qty}</td>
                      <td className="price-cell">${t.price.toFixed(2)}</td>
                      <td className={t.action === "BUY" ? "negative" : "positive"}>{t.action === "BUY" ? "−" : "+"}${t.total.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <p className="source-note">
        {seasonLabel} season · {TEAM_HISTORY.length} D-I teams · Price = AdjEM ÷ shares · Buying power = dividends + cash · Budget: ${budget}
        {dividendMultiplier !== 1 && <> · Dividends ×{dividendMultiplier}</>}
      </p>

      {/* ══ TEAM MODAL ═══════════════════════════════════════════════════════ */}
      {selectedTeam && teamDetail && (
        <div className="modal-overlay" onClick={() => setSelectedTeam(null)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="modal-team">{teamDetail.team}</h2>
                <span className="conf-badge">{teamDetail.conference}</span>
              </div>
              <button className="modal-close" onClick={() => setSelectedTeam(null)}>✕</button>
            </div>

            <div className="modal-stats">
              {[
                ["AdjEM",       `+${teamDetail.weeklyAdjEM[week].toFixed(2)}`],
                ["Price/share", `$${sharePrice(teamDetail.weeklyAdjEM[week]).toFixed(2)}`],
                ["Shares",      calcShares(teamDetail.weeklyAdjEM[week])],
                ["You own",     portfolio[selectedTeam] || 0],
              ].map(([label, val]) => (
                <div className="modal-stat" key={label}><div className="stat-label">{label}</div><div className="stat-value">{val}</div></div>
              ))}
            </div>

            <div className="chart-title" style={{ marginBottom: 8 }}>AdjEM history — hover to see game results</div>
            <LineChart
              data={teamDetail.dataUpToNow}
              labels={WEEKS}
              color="#1D9E75"
              height={130}
              currentIdx={teamDetail.dataUpToNow.length - 1}
              tooltipRows={teamDetail.tooltipRows}
            />

            <div className="chart-title" style={{ marginTop: 16, marginBottom: 8 }}>Share price history</div>
            <LineChart data={teamDetail.priceHistory} labels={WEEKS} color="#185FA5" height={100} currentIdx={teamDetail.priceHistory.length - 1} />

            <div className="schedule-panels">
              <div className="schedule-panel">
                <div className="schedule-panel-title">Last 5 results</div>
                {!teamDetail.hasSchedule
                  ? <div className="schedule-empty">Detailed schedule not available for this team.</div>
                  : teamDetail.last5.length === 0
                    ? <div className="schedule-empty">No games played yet this season.</div>
                    : teamDetail.last5.map((g, i) => <GameRow key={i} game={g} showAdjEM={false} />)
                }
              </div>

              <div className="schedule-panel">
                <div className="schedule-panel-title">Next 5 games <span className="schedule-panel-sub">opponent AdjEM shown</span></div>
                {!teamDetail.hasSchedule
                  ? <div className="schedule-empty">Detailed schedule not available for this team.</div>
                  : teamDetail.next5.length === 0
                    ? <div className="schedule-empty">No upcoming games scheduled.</div>
                    : teamDetail.next5.map((g, i) => <UpcomingGameRow key={i} game={g} weeks={WEEKS} />)
                }
              </div>
            </div>


            {teamDetail.earnedDivs.length > 0 && (
              <>
                <div className="chart-title" style={{ marginTop: 16, marginBottom: 8 }}>Dividends earned so far</div>
                <div className="upcoming-divs">
                  {teamDetail.earnedDivs.map((d, i) => (
                    <div key={i} className="upcoming-div-row">
                      <span className="record">{d.weekLabel}</span>
                      <span className="event-label">{d.event}</span>
                      <span className="div-earned">+${d.payout.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <ModalActions
              teamDetail={teamDetail}
              week={week}
              selectedTeam={selectedTeam}
              portfolio={portfolio}
              buyingPower={buyingPower}
              buyShare={buyShare}
              sellShare={sellShare}
            />
          </div>
        </div>
      )}

      {/* ══ SETTINGS MODAL ═══════════════════════════════════════════════════ */}
      {showSettings && (
        <SettingsModal
          seasonId={seasonId}
          budget={budget}
          dividendMultiplier={dividendMultiplier}
          dividendOverrides={dividendOverrides}
          onChangeSeason={(newId) => {
            if (newId === seasonId) return;
            const newLabel = getSeason(newId).label;
            const ok = window.confirm(`Switch to ${newLabel}? This will reset your current game.`);
            if (!ok) return;
            setSeasonId(newId);
            setWeek(0);
            setPortfolio({});
            setCash(budget);
            setDividendBank(0);
            setTeamDividends({});
            setDraftMode(true);
            setView(VIEW_MARKET);
            setSearch("");
            setConfFilter("");
            setTradeLog([]);
            setDividendLog([]);
            setSelectedTeam(null);
            setPortfolioHistory([budget]);
          }}
          onChangeBudget={setBudget}
          onChangeMultiplier={setDividendMultiplier}
          onChangeOverride={(key, value) =>
            setDividendOverrides((o) => ({ ...o, [key]: value }))
          }
          onResetOverrides={() => setDividendOverrides(buildDefaultOverrides())}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
