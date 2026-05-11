import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useMarket } from "../context/MarketContext";
import { getTransactionLog } from "../lib/supabase";

const FAILURE_LABELS = {
  not_enough_funds:   "Insufficient funds",
  shares_unavailable: "Shares unavailable",
  no_shares_to_sell:  "No shares owned",
};

export default function LogPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { market } = useMarket();

  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!market?.id) return;
    setLoading(true);
    setError("");
    getTransactionLog(market.id)
      .then(setLog)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [market?.id]);

  // Group by week, keys sorted descending
  const byWeek = log.reduce((acc, row) => {
    (acc[row.week] ??= []).push(row);
    return acc;
  }, {});
  const weeks = Object.keys(byWeek).map(Number).sort((a, b) => b - a);

  return (
    <div className="container">
      <div className="topbar">
        <div className="topbar-left">
          <h1 className="app-title">Folio</h1>
          <span className="log-page-label">Transaction Log</span>
          {market?.name && <span className="log-market-badge">{market.name}</span>}
        </div>
        <div className="topbar-right">
          <button className="tab-btn" onClick={() => navigate("/market")}>← Market</button>
        </div>
      </div>

      {!market?.id && !loading && (
        <div className="log-empty">
          No market selected.{" "}
          <button className="log-link-btn" onClick={() => navigate("/market")}>Go to Market</button>
        </div>
      )}

      {loading && <div className="log-loading">Loading…</div>}

      {error && <div className="log-error">{error}</div>}

      {!loading && !error && market?.id && weeks.length === 0 && (
        <div className="log-empty">
          No executed transactions yet. Queue requests will appear here after an admin runs Execute Queue.
        </div>
      )}

      {weeks.map((week) => (
        <div key={week} className="log-week-group">
          <div className="log-week-header">Week {week}</div>
          <div className="log-table-wrap">
            <table className="log-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Action</th>
                  <th>Team</th>
                  <th>Price</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {byWeek[week].map((row) => {
                  const isMe = row.user_id === user?.id;
                  return (
                    <tr key={row.id} className={row.status === "failed" ? "log-row-failed" : ""}>
                      <td className="log-player">
                        {isMe && <span className="log-you-tag">you</span>}
                        {row.playerEmail}
                      </td>
                      <td className={`log-action log-action-${row.action}`}>
                        {row.action === "buy" ? "Buy" : "Sell"}
                      </td>
                      <td className="log-team">{row.team_id}</td>
                      <td className="log-price">${Number(row.price_per_share).toFixed(2)}</td>
                      <td className="log-result">
                        {row.status === "executed" ? (
                          <span className="log-success">Executed</span>
                        ) : (
                          <span className="log-fail">
                            Failed — {FAILURE_LABELS[row.failure_reason] ?? row.failure_reason}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
