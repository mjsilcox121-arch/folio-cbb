// src/lib/providers/torvik.js
// Bart Torvik T-Rank adapter — primary efficiency rating source.
//
// Data is served directly from barttorvik.com as JSON files that update
// constantly during the season. No auth, no scraping, no bot issues.
// Endpoint: http://barttorvik.com/YYYY_team_results.json
//   where YYYY = season end year (e.g. 2026 for the 2025-26 season)
//
// Implements the Folio provider interface:
//   fetchTeams(year?)       → Team[]
//   fetchTeam(name, year?)  → Team | null
//   parseTeams(rawArray)    → Team[]  (normalize pre-fetched data)
//   fetchSchedule()         → NOT SUPPORTED — use sportsref or espn
//
// Provider interface shape:
//   Team: {
//     name, conference, efficiency_rating, record,
//     shares_total, share_price, data_source, last_updated
//   }

const BASE_URL = "http://barttorvik.com";

/**
 * Fetch all D-I team ratings from Torvik for a given season.
 * @param {number} year - Season end year, e.g. 2026 for the 2025-26 season
 * @returns {Promise<Array>} Normalized team objects in provider interface shape
 */
export async function fetchTeams(year = currentSeasonYear()) {
  const url = `${BASE_URL}/${year}_team_results.json`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Folio-CBB-App/1.0 (non-commercial; mjsilcox121@gmail.com)" },
  });

  if (!res.ok) {
    throw new Error(`Torvik API error: ${res.status} ${res.statusText} — ${url}`);
  }

  const raw = await res.json();
  return parseTeams(raw);
}

/**
 * Fetch a single team by name.
 */
export async function fetchTeam(teamName, year = currentSeasonYear()) {
  const teams = await fetchTeams(year);
  const target = teamName.toLowerCase();
  return teams.find((t) => t.name.toLowerCase() === target) ?? null;
}

/**
 * Normalize a raw array already fetched from Torvik.
 * Useful when you have the JSON in hand (e.g. from a scheduled task).
 * @param {Array} rawArray - Parsed JSON from YYYY_team_results.json
 * @returns {Array} Normalized team objects
 */
export function parseTeams(rawArray) {
  if (!Array.isArray(rawArray)) {
    throw new Error(`parseTeams: expected array, got ${typeof rawArray}`);
  }

  return rawArray
    .filter((row) => Array.isArray(row) && row.length >= 7)
    .map((row) => {
      // Column order in YYYY_team_results.json:
      //   [0]  rank
      //   [1]  team name
      //   [2]  conference
      //   [3]  record ("W-L")
      //   [4]  adj_o  (offensive efficiency per 100 possessions)
      //   [5]  adj_o rank
      //   [6]  adj_d  (defensive efficiency, lower = better)
      //   ...
      // adj_em (net efficiency) = adj_o - adj_d — no direct column
      const adjO  = parseFloat(row[4]);
      const adjD  = parseFloat(row[6]);
      const adjEM = (Number.isFinite(adjO) && Number.isFinite(adjD))
        ? Math.round((adjO - adjD) * 100) / 100
        : null;

      return normalizeTeam({
        name:              String(row[1]).trim(),
        conference:        String(row[2]).trim(),
        efficiency_rating: adjEM,
        record:            String(row[3]).trim() || null,
      });
    })
    .filter((t) => t.name);
}

/**
 * Torvik does not provide schedule data.
 */
export async function fetchSchedule() {
  throw new Error(
    "torvik provider does not support fetchSchedule. " +
    "Use sportsref (primary) or espn (fallback) for schedule data."
  );
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function normalizeTeam({ name, conference, efficiency_rating, record }) {
  const shares_total = calcShares(efficiency_rating);
  const share_price  = efficiency_rating != null
    ? Math.round((efficiency_rating / shares_total) * 100) / 100
    : null;

  return {
    name,
    conference,
    efficiency_rating,
    record,
    shares_total,
    share_price,
    data_source:  "torvik",
    last_updated: new Date().toISOString(),
  };
}

function calcShares(efficiencyRating) {
  if (!efficiencyRating || efficiencyRating <= 0) return 1;
  return Math.floor(efficiencyRating / 10) + 1;
}

/**
 * Returns the current season end year.
 * Before August we're still in the season that ended in spring.
 */
function currentSeasonYear() {
  const now = new Date();
  return now.getMonth() < 7 ? now.getFullYear() : now.getFullYear() + 1;
}
