// src/lib/gameUtils.js
// Shared game logic and display utilities used across components.

// ── Share / price formulas ────────────────────────────────────────────────────
// These must remain consistent everywhere — changing them changes game balance.
// Parameter renamed from adjEM → efficiencyRating (Day 8) for source-agnostic naming.
// Callers pass the value positionally, so no call-site changes are required.
export function calcShares(efficiencyRating) {
  if (!efficiencyRating || efficiencyRating <= 0) return 1;
  return Math.floor(efficiencyRating / 10) + 1;
}

export function sharePrice(efficiencyRating) {
  return efficiencyRating / calcShares(efficiencyRating);
}

// ── Team color palette ────────────────────────────────────────────────────────
export const TEAM_COLORS = [
  "#1D9E75","#185FA5","#D85A30","#8B4FC8","#C4960F",
  "#2E86AB","#A23B72","#3D9970","#FF6B6B","#4ECDC4",
  "#45B7D1","#96CEB4","#FFEAA7","#DDA0DD","#98D8C8",
  "#F7DC6F","#BB8FCE","#85C1E9","#F1948A","#82E0AA",
];

export function teamColor(idx) {
  return TEAM_COLORS[idx % TEAM_COLORS.length];
}
