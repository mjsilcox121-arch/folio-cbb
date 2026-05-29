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
  const locLabel  = game.location === "H" ? "vs" : game.location === "A" ? "@" : "vs";
  const adjEM     = game.opponentAdjEM ?? 0;
  const strength  = adjEM >= 25 ? "elite" : adjEM >= 18 ? "strong" : adjEM >= 12 ? "mid" : "weak";
  return (
    <div className="game-row upcoming">
      <span className={`opp-strength ${strength}`}>{strength.toUpperCase()}</span>
      <span className="game-opponent">
        <span className="game-loc">{locLabel}</span> {game.opponent}
        {game.opponentAdjEM != null && <span className="game-adjEM"> (+{adjEM.toFixed(1)} AdjEM)</span>}
      </span>
      <span className="game-week-label">{weeks?.[game.week - 1]?.split(" ")[0] ?? `W${game.week}`}</span>
    </div>
  );
}

const MAX_QUEUE = 10;

// ── Queue-based action bar ─────────────────────────────────────────────────────
function ModalActions({ teamDetail, week, selectedTeam, portfolio, buyingPower, queueRequests, submitting, portfolioLocked, onQueueBuy, onQueueSell, onCancelRequest }) {
  const adjEM       = teamDetail.weeklyAdjEM[week];
  const totalShares = calcShares(adjEM);
  const ownedNow    = portfolio[selectedTeam] || 0;
  const atMax       = ownedNow >= totalShares;
  const priceNow    = Math.round(sharePrice(adjEM) * 100) / 100;

  const pendingRequests = queueRequests.filter((r) => r.status === "pending");
  const pendingCount    = pendingRequests.length;
  const atQueueLimit    = pendingCount >= MAX_QUEUE;

  // Pending request for this team specifically
  const teamPending = pendingRequests.find((r) => r.team_id === selectedTeam);

  const cantAfford  = buyingPower < priceNow - 0.001;
  const buyDisabled = submitting || atMax || cantAfford || atQueueLimit;
  const sellDisabled = submitting || !ownedNow || atQueueLimit;

  if (portfolioLocked) {
    return (
      <div className="modal-actions-wrap">
        <div className="portfolio-locked-notice">
          <span className="portfolio-locked-icon">🔒</span>
          <span>Portfolios are locked — trading opens when the admin advances to Week 1.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-actions-wrap">
      <div className="queue-limit-bar">
        <span className={`queue-count-badge ${atQueueLimit ? "queue-count-full" : ""}`}>
          {pendingCount} / {MAX_QUEUE} requests this week
        </span>
        {atQueueLimit && <span className="queue-limit-msg">Queue full — cancel a request to add another</span>}
      </div>

      {teamPending ? (
        <div className="modal-pending-row">
          <span className={`action-pill ${teamPending.action}`}>{teamPending.action.toUpperCase()}</span>
          <span className="modal-pending-label">queued for this team</span>
          <button className="queue-cancel-btn" onClick={() => onCancelRequest(teamPending.id)} disabled={submitting}>
            Cancel request
          </button>
        </div>
      ) : (
        <div className="modal-actions">
          <button
            className="buy-btn large"
            onClick={() => onQueueBuy(selectedTeam)}
            disabled={buyDisabled}
            title={atMax ? `All ${totalShares} shares owned` : atQueueLimit ? "Queue full" : undefined}
          >
            {submitting ? "Adding…" : atMax ? `All ${totalShares} shares owned` : `Queue Buy — $${priceNow.toFixed(2)}`}
          </button>
          <button
            className="sell-btn large"
            onClick={() => onQueueSell(selectedTeam)}
            disabled={sellDisabled}
            title={atQueueLimit ? "Queue full" : undefined}
          >
            {submitting ? "Adding…" : "Queue Sell"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main export: full modal overlay ───────────────────────────────────────────
export default function TeamModal({ selectedTeam, teamDetail, week, weeks, portfolio, buyingPower, queueRequests, submitting, portfolioLocked, onQueueBuy, onQueueSell, onCancelRequest, onClose }) {
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
          queueRequests={queueRequests}
          submitting={submitting}
          portfolioLocked={portfolioLocked}
          onQueueBuy={onQueueBuy}
          onQueueSell={onQueueSell}
          onCancelRequest={onCancelRequest}
        />
      </div>
    </div>
  );
}
