// src/components/QueuePanel.jsx
// Shows the current player's queue for the active week.
// Only renders when there are requests to display.

const MAX_REQUESTS = 10;

function statusClass(status) {
  if (status === "pending")  return "queue-status-pending";
  if (status === "executed") return "queue-status-executed";
  return "queue-status-failed";
}

function statusLabel(status) {
  if (status === "pending")  return "Pending";
  if (status === "executed") return "Executed";
  return "Failed";
}

export default function QueuePanel({ requests, weekLabel, onCancel, submitting, portfolioLocked }) {
  if (portfolioLocked) {
    return (
      <div className="queue-panel">
        <div className="portfolio-locked-notice">
          <span className="portfolio-locked-icon">🔒</span>
          <span>Portfolios are locked — trading opens when the admin advances to Week 1.</span>
        </div>
      </div>
    );
  }

  if (!requests || requests.length === 0) return null;

  const pendingCount = requests.filter((r) => r.status === "pending").length;

  return (
    <div className="queue-panel">
      <div className="queue-panel-header">
        <span className="section-title" style={{ margin: 0 }}>
          My Queue — {weekLabel}
        </span>
        <span className={`queue-count-badge ${pendingCount >= MAX_REQUESTS ? "queue-count-full" : ""}`}>
          {pendingCount} / {MAX_REQUESTS} pending
        </span>
      </div>

      <div className="queue-rows">
        {requests.map((r) => (
          <div key={r.id} className={`queue-row queue-row-${r.status}`}>
            <span className={`action-pill ${r.action}`}>{r.action.toUpperCase()}</span>
            <span className="queue-team">{r.team_id}</span>
            <span className={`queue-status-badge ${statusClass(r.status)}`}>
              {statusLabel(r.status)}
              {r.failure_reason && (
                <span className="queue-failure-reason"> — {r.failure_reason.replace(/_/g, " ")}</span>
              )}
            </span>
            {r.status === "pending" && (
              <button
                className="queue-cancel-btn"
                onClick={() => onCancel(r.id)}
                disabled={submitting}
              >
                Cancel
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
