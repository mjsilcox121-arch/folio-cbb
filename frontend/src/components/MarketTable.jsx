// src/components/MarketTable.jsx
// The main market view: search/filter controls + sortable team table.

import Delta from "./Delta";

export default function MarketTable({
  filteredTeams,
  totalTeams,
  portfolio,
  buyingPower,
  week,
  draftMode,
  sortCol,
  sortAsc,
  search,
  confFilter,
  conferences,
  maxAdjEM,
  tradePending,
  onSearch,
  onConfFilter,
  onSort,
  onBuy,
  onSell,
  onSelectTeam,
}) {
  function arrow(col) {
    if (sortCol !== col) return null;
    return <span className="sort-arrow">{sortAsc ? "▲" : "▼"}</span>;
  }

  return (
    <>
      <div className="controls">
        <input
          type="text"
          placeholder={`Search all ${totalTeams} teams...`}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
        <select value={confFilter} onChange={(e) => onConfFilter(e.target.value)}>
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
              <th onClick={() => onSort("team")}>Team {arrow("team")}</th>
              <th onClick={() => onSort("conference")}>Conf {arrow("conference")}</th>
              <th onClick={() => onSort("record")}>Record {arrow("record")}</th>
              <th onClick={() => onSort("adjEM")}>Rating {arrow("adjEM")}</th>
              <th onClick={() => onSort("adjEMDelta")}>Rating Chg {arrow("adjEMDelta")}</th>
              <th onClick={() => onSort("shares")}>Shares {arrow("shares")}</th>
              <th onClick={() => onSort("price")}>Price {arrow("price")}</th>
              <th onClick={() => onSort("priceDelta")}>Price Chg {arrow("priceDelta")}</th>
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
                  <td><button className="team-link" onClick={() => onSelectTeam(t.team)}>{t.team}</button></td>
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
                      <button className="buy-btn" onClick={() => onBuy(t.team)} disabled={tradePending || !canBuy}
                        title={atMax ? `All ${t.shares} shares owned` : undefined}>Buy</button>
                      <button className="sell-btn" onClick={() => onSell(t.team)} disabled={tradePending || owned === 0}>Sell</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="source-note">{filteredTeams.length} of {totalTeams} teams · Click team name for team sheet</p>
    </>
  );
}
