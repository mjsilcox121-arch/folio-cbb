// src/lib/providers/espn.js
// ESPN unofficial API adapter — fallback source for schedules and game scores.
//
// Implements the Folio provider interface:
//   fetchTeams()  → NOT SUPPORTED (ESPN has no efficiency ratings — use torvik)
//   fetchSchedule(teamName, year?)  → Schedule
//   fetchGameResults(teamName, year?)  → GameResult[]
//
// Provider interface shape:
//   Schedule: {
//     team_name, games: [{ opponent, result, score, location, week }]
//   }
//   GameResult: { team_name, opponent, result, score, date }
//
// ESPN API notes:
//   - Unofficial but stable public endpoint, no API key required
//   - CORS-friendly — can be called from browser or server-side
//   - Team IDs must be resolved from the /teams endpoint first
//   - ESPN uses its own team naming — the teamNameToEspnSlug map below handles
//     common cases; extend it as needed

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball";

// ── Season helpers ─────────────────────────────────────────────────────────

/**
 * Convert a season end-year to the ESPN season parameter.
 * ESPN uses the end year of the season (e.g. 2025 for 2024-25).
 */
function toEspnSeason(year) {
  return String(year);
}

// ── Team lookup ────────────────────────────────────────────────────────────

/** Cache to avoid re-fetching the full team list on every call */
const _teamCache = new Map();

/**
 * Search ESPN for a team ID by name. Returns the ESPN team object or null.
 */
async function findEspnTeam(teamName) {
  const key = teamName.toLowerCase();

  if (_teamCache.has(key)) return _teamCache.get(key);

  const url = `${ESPN_BASE}/teams?limit=500`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN teams lookup failed: ${res.status}`);
  const data = await res.json();

  const teams = data?.sports?.[0]?.leagues?.[0]?.teams ?? [];
  for (const entry of teams) {
    const t = entry.team;
    const names = [
      t.displayName?.toLowerCase(),
      t.shortDisplayName?.toLowerCase(),
      t.nickname?.toLowerCase(),
      t.abbreviation?.toLowerCase(),
    ];
    _teamCache.set(t.displayName?.toLowerCase(), t);
    if (names.includes(key)) {
      return t;
    }
  }

  return null;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * ESPN does not provide efficiency ratings. Use the torvik adapter instead.
 */
export async function fetchTeams() {
  throw new Error(
    "espn provider does not support fetchTeams. " +
    "Use torvik for efficiency rating data."
  );
}

/**
 * Fetch a team's schedule and results from ESPN for a given season.
 * @param {string} teamName - Team name as used in the Folio app
 * @param {number} year     - Season end year (e.g. 2025 for 2024-25)
 * @returns {Promise<Object>} Schedule in provider interface shape
 */
export async function fetchSchedule(teamName, year = new Date().getFullYear()) {
  const espnTeam = await findEspnTeam(teamName);
  if (!espnTeam) {
    throw new Error(`ESPN: team not found — "${teamName}". Check the name or extend teamNameToEspnSlug.`);
  }

  const season = toEspnSeason(year);
  const url = `${ESPN_BASE}/teams/${espnTeam.id}/schedule?season=${season}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN schedule fetch failed: ${res.status} — ${url}`);
  const data = await res.json();

  const events = data?.events ?? [];
  const games = events
    .map((event) => parseEspnEvent(event, teamName))
    .filter(Boolean);

  return {
    team_name: teamName,
    games,
  };
}

/**
 * Fetch only completed game results for a team.
 */
export async function fetchGameResults(teamName, year = new Date().getFullYear()) {
  const schedule = await fetchSchedule(teamName, year);
  return schedule.games
    .filter((g) => g.result !== null)
    .map((g) => ({
      team_name: teamName,
      opponent:  g.opponent,
      result:    g.result,
      score:     g.score,
      date:      g.date ?? null,
    }));
}

// ── Internal helpers ──────────────────────────────────────────────────────

/**
 * Parse a single ESPN event object into the provider's game shape.
 */
function parseEspnEvent(event, ourTeamName) {
  try {
    const competition = event.competitions?.[0];
    if (!competition) return null;

    const competitors = competition.competitors ?? [];
    const us   = competitors.find((c) => matchesTeam(c.team?.displayName, ourTeamName));
    const them = competitors.find((c) => !matchesTeam(c.team?.displayName, ourTeamName));

    if (!us || !them) return null;

    // Location: home/away/neutral
    const isHome    = us.homeAway === "home";
    const isNeutral = competition.neutralSite === true;
    const location  = isNeutral ? "N" : isHome ? "H" : "A";

    // ESPN returns score as either a plain string/number OR an object like
    // { value: 78, displayValue: "78" } — handle both
    const ourScore   = extractScore(us.score);
    const theirScore = extractScore(them.score);
    const hasScores  = ourScore !== null && theirScore !== null;

    const completed = competition.status?.type?.completed === true
      || competition.status?.type?.state === "post"
      || competition.status?.type?.name === "STATUS_FINAL"
      || hasScores;

    let result = null;
    let score  = null;
    if (completed && hasScores) {
      result = ourScore > theirScore ? "W" : "L";
      score  = `${ourScore}-${theirScore}`;
    }

    return {
      opponent: them.team?.displayName ?? "Unknown",
      result,
      score,
      location,
      week:   null, // Week mapping happens in dataProvider.js
      date:   event.date ?? null,
    };
  } catch {
    return null;
  }
}

function matchesTeam(espnName, ourName) {
  if (!espnName || !ourName) return false;
  return espnName.toLowerCase().includes(ourName.toLowerCase()) ||
         ourName.toLowerCase().includes(espnName.toLowerCase());
}

/**
 * ESPN returns scores as plain strings, plain numbers, OR objects like
 * { value: 78, displayValue: "78" }. Extract a clean integer from any of these.
 */
function extractScore(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const n = parseInt(raw, 10);
    return isNaN(n) ? null : n;
  }
  if (typeof raw === "object") {
    // Try common ESPN score object keys
    const val = raw.value ?? raw.displayValue ?? raw.score;
    if (val === null || val === undefined) return null;
    const n = parseInt(String(val), 10);
    return isNaN(n) ? null : n;
  }
  return null;
}
