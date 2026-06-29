// src/components/Leaderboard.jsx
// Shows all players in the market ranked by total portfolio value.
// Only renders when there are 2+ players — no-op in solo play.

export default function Leaderboard({ entries, currentUserId, loading }) {
  if (loading) return (
    <div className="leaderboard-card">
      <div className="leaderboard-loading">Loading leaderboard…</div>
    </div>
  );
  if (!entries || entries.length < 2) return null;

  return (
    <div className="leaderboard-card">
      <div className="leaderboard-header">
        <span className="section-title" style={{ margin: 0 }}>Leaderboard</span>
      </div>
      <table className="leaderboard-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Player</th>
            <th>Portfolio Value</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => {
            const isMe = e.userId === currentUserId;
            return (
              <tr key={e.userId} className={isMe ? "leaderboard-me" : ""}>
                <td className="leaderboard-rank">
                  {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
                </td>
                <td className="leaderboard-name">
                  {e.email}
                  {isMe && <span className="leaderboard-you-tag">you</span>}
                </td>
                <td className="leaderboard-value">${e.totalValue.toFixed(2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
