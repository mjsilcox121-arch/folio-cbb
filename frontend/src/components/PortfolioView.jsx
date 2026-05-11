// src/components/PortfolioView.jsx
// Portfolio page: value chart, composition pie, holdings table, dividend log, trade log.

import Delta from "./Delta";
import { PieChart, PieLegend } from "./PieChart";
import LineChart from "./LineChart";
import { teamColor } from "../lib/gameUtils";

export default function PortfolioView({
  portfolioRows,
  portfolioHistory,
  portfolioValueDelta,
  chartLabels,         // aligned with portfolioHistory length
  pieSlices,
  pieTotal,
  holdingsValue,
  dividendsEarned,     // renamed from dividendBank — cumulative total received
  weekDividendTotal,
  dividendLog,
  tradeLog,
  week,
  weeks,
  teamsThisWeek,
  buyingPower,
  tradePending,        // true while a DB buy/sell is in flight
  buyShare,
  sellShare,
  onSelectTeam,
  onGoToMarket,
}) {
  return (
    <>
      {/* Value chart + composition pie */}
      <div className="portfolio-top-row">
        <div className="chart-card flex-grow">
          {portfolioHistory.length > 1 ? (
            <>
              <div className="chart-title">
                Portfolio value over time {portfolioValueDelta != null && <Delta value={portfolioValueDelta} />}
              </div>
              <LineChart
                data={portfolioHistory}
                labels={chartLabels ?? ["Start", ...weeks]}
                color="#1D9E75"
                height={160}
                currentIdx={portfolioHistory.length - 1}
              />
            </>
          ) : (
            <div className="chart-placeholder">Advance through weeks to see your portfolio chart.</div>
          )}
        </div>
        <div className="chart-card pie-card">
          <div className="chart-title">Portfolio composition</div>
          {pieSlices.length > 0
            ? <><PieChart slices={pieSlices} size={200} /><PieLegend slices={pieSlices} total={pieTotal} /></>
            : <div className="pie-empty">Buy shares to see composition.</div>}
        </div>
      </div>

      {/* Week summary banner */}
      {week > 0 && (portfolioValueDelta != null || weekDividendTotal > 0) && (
        <div className="week-summary-banner">
          <strong>{weeks[week]}</strong>
          {portfolioValueDelta != null && <span>Total Δ: <Delta value={portfolioValueDelta} /></span>}
          {weekDividendTotal > 0 && (
            <span className="div-banner-earned">
              🏀 Dividends: <strong>+${weekDividendTotal.toFixed(2)}</strong> ({dividendLog.filter((d) => d.week === week).length} events)
            </span>
          )}
        </div>
      )}

      {/* Holdings table */}
      {portfolioRows.length === 0 ? (
        <div className="empty-portfolio">
          <p>Your portfolio is empty.</p>
          <p>Go to the <button className="link-btn" onClick={onGoToMarket}>Market</button> to buy shares.</p>
        </div>
      ) : (
        <div className="table-wrap" style={{ marginBottom: "1.5rem" }}>
          <table>
            <thead>
              <tr>
                <th>Team</th><th>Conf</th><th>Rating</th><th>Rating Chg</th>
                <th>Price</th><th>Price Chg</th><th>Owned</th><th>Position $</th>
                <th>Pos Chg</th><th>Divs (wk)</th><th>Divs (total)</th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              {portfolioRows.map((row) => {
                const teamShares = teamsThisWeek.find((t) => t.team === row.teamName)?.shares ?? Infinity;
                return (
                  <tr key={row.teamName}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="team-color-dot" style={{ background: teamColor(row.idx) }} />
                        <button className="team-link" onClick={() => onSelectTeam(row.teamName)}>{row.teamName}</button>
                      </div>
                    </td>
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
                    <td>
                      <div className="action-btns">
                        <button className="buy-btn" onClick={() => buyShare(row.teamName)}
                          disabled={tradePending || buyingPower < row.price - 0.001 || row.owned >= teamShares}>
                          Buy
                        </button>
                        <button className="sell-btn" onClick={() => sellShare(row.teamName)}
                          disabled={tradePending}>
                          Sell
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="totals-row">
                <td colSpan={7}></td>
                <td className="position-value totals-value">${holdingsValue.toFixed(2)}</td>
                <td>{portfolioValueDelta != null && week > 0 && <Delta value={portfolioValueDelta} />}</td>
                <td className="div-earned totals-value">{weekDividendTotal > 0 ? `+$${weekDividendTotal.toFixed(2)}` : "—"}</td>
                <td className="div-earned totals-value">${dividendsEarned.toFixed(2)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Dividend history */}
      <div className="section-title">
        Dividend history {dividendsEarned > 0 && <span className="div-total-pill">${dividendsEarned.toFixed(2)} earned</span>}
      </div>
      {dividendLog.length === 0 ? (
        <div className="empty-log">No dividends yet.</div>
      ) : (
        <div className="table-wrap" style={{ marginBottom: "1.5rem" }}>
          <table>
            <thead><tr><th>Week</th><th>Team</th><th>Event</th><th>Base</th><th>Shares</th><th>Payout</th></tr></thead>
            <tbody>
              {dividendLog.map((d, i) => (
                <tr key={i} className={d.week === week ? "new-div-row" : ""}>
                  <td className="record">{weeks[d.week] ?? `Wk ${d.week}`}</td>
                  <td><button className="team-link" onClick={() => onSelectTeam(d.team)}>{d.team}</button></td>
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

      {/* Trade history */}
      <div className="section-title">Trade history</div>
      {tradeLog.length === 0 ? (
        <div className="empty-log">No trades yet.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Week</th><th>Team</th><th>Action</th><th>Qty</th><th>Price/share</th><th>Cash impact</th></tr></thead>
            <tbody>
              {tradeLog.map((t, i) => (
                <tr key={i}>
                  <td className="record">{weeks[t.week] ?? `Wk ${t.week}`}</td>
                  <td><button className="team-link" onClick={() => onSelectTeam(t.team)}>{t.team}</button></td>
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
  );
}
