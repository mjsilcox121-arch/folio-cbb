// src/components/SettingsModal.jsx
// Admin settings panel: season switcher, budget, dividend multiplier, rule overrides.

import { useState } from "react";
import { SEASONS, DIVIDEND_RULES } from "../seasons";

const MIN_MULTIPLIER = 0.5;
const MAX_MULTIPLIER = 3;

export default function SettingsModal({
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

  function commitBudget() {
    const n = Number(budgetInput);
    if (!Number.isFinite(n) || n <= 0) { setBudgetInput(String(budget)); return; }
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

        {/* Season */}
        <div className="settings-section">
          <label className="settings-label">Season</label>
          <p className="settings-help">Switching seasons resets your game.</p>
          <select className="settings-select" value={seasonId} onChange={(e) => onChangeSeason(e.target.value)}>
            {SEASONS.map((s) => (
              <option key={s.id} value={s.id}>{s.label} — Champion: {s.champion}</option>
            ))}
          </select>
        </div>

        {/* Starting budget */}
        <div className="settings-section">
          <label className="settings-label" htmlFor="settings-budget">Starting budget ($)</label>
          <p className="settings-help">Applied on the next reset.</p>
          <input
            id="settings-budget" type="number" min="1" max="10000"
            className="settings-input" value={budgetInput}
            onChange={(e) => setBudgetInput(e.target.value)}
            onBlur={commitBudget}
            onKeyDown={(e) => { if (e.key === "Enter") commitBudget(); }}
          />
        </div>

        {/* Dividend multiplier */}
        <div className="settings-section">
          <label className="settings-label" htmlFor="settings-mult">
            Dividend multiplier <span className="settings-pill">×{dividendMultiplier.toFixed(2)}</span>
          </label>
          <p className="settings-help">Scales every dividend payout. Takes effect from the next week advance onward.</p>
          <input
            id="settings-mult" type="range"
            min={MIN_MULTIPLIER} max={MAX_MULTIPLIER} step="0.05"
            value={dividendMultiplier}
            onChange={(e) => onChangeMultiplier(Number(e.target.value))}
            className="settings-slider"
          />
          <div className="settings-slider-ticks">
            <span>{MIN_MULTIPLIER}×</span><span>1×</span><span>{MAX_MULTIPLIER}×</span>
          </div>
        </div>

        {/* Dividend rule amounts */}
        <div className="settings-section">
          <div className="settings-row-between">
            <label className="settings-label">Dividend amounts</label>
            <button className="settings-reset-btn" onClick={onResetOverrides}>Reset to defaults</button>
          </div>
          <p className="settings-help">Base value paid per share owned for each event type. Multiplier applies on top.</p>
          <div className="settings-rules-table">
            <table>
              <thead><tr><th>Event</th><th>Default</th><th>Override</th></tr></thead>
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
                          type="number" min="0" step="1" className="rule-input" value={cur}
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
