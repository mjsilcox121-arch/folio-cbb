// src/components/TeamModal.jsx
// Full team detail modal: price/AdjEM charts, schedule panels, buy/sell actions.

import LineChart from "./LineChart";
import { calcShares, sharePrice } from "../lib/gameUtils";

// ── Game result row ────────────────────────────────────────────────────────────
function GameRow({ game }) {
  const isWin = game.result === "W";
  const locLabel = game.location === "H" ? "vs" : game.location === "A" ? "@" : "vs";
  return (
    <div className={`game-row ${isWin ? "game-win" : "game-loss"}`}>
      <span className={`game-result-badge ${isWin ? "win" : "loss"}`}>{game.result}</span>
      <span className="game-opponent">
        <span className="game-loc">{locLabel}</span> {game.opponent}
      </span>
      <span className="game-score">{game.score || ""}</span>
    </div>
  );
}

// ── Upcoming game row ──────────────────────────────────────────────────────────
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

// ── Buy/Sell action bar ────────────────────────────────────────────────────────
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

// ── Main export: full modal overlay ───────────────────────────────────────────
export default function TeamModal({ selectedTeam, teamDetail, week, weeks, portfolio, buyingPower, buyShare, sellShare, onClose }) {
  if (!selectedTeam || !teamDetail) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-team">{teamDetail.team}</h2>
            <span className="conf-badge">{teamDetail.conference}</span>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
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
          labels={weeks}
          color="#1D9E75"
          height={130}
          currentIdx={teamDetail.dataUpToNow.length - 1}
          tooltipRows={teamDetail.tooltipRows}
        />

        <div className="chart-title" style={{ marginTop: 16, marginBottom: 8 }}>Share price history</div>
        <LineChart data={teamDetail.priceHistory} labels={weeks} color="#185FA5" height={100} currentIdx={teamDetail.priceHistory.length - 1} />

        <div className="schedule-panels">
          <div className="schedule-panel">
            <div className="schedule-panel-title">Last 5 results</div>
            {!teamDetail.hasSchedule
              ? <div className="schedule-empty">Detailed schedule not available for this team.</div>
              : teamDetail.last5.length === 0
                ? <div className="schedule-empty">No games played yet this season.</div>
                : teamDetail.last5.map((g, i) => <GameRow key={i} game={g} />)
            }
          </div>
          <div className="schedule-panel">
            <div className="schedule-panel-title">Next 5 games <span className="schedule-panel-sub">opponent AdjEM shown</span></div>
            {!teamDetail.hasSchedule
              ? <div className="schedule-empty">Detailed schedule not available for this team.</div>
              : teamDetail.next5.length === 0
                ? <div className="schedule-empty">No upcoming games scheduled.</div>
                : teamDetail.next5.map((g, i) => <UpcomingGameRow key={i} game={g} weeks={weeks} />)
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
  );
}
