// src/lib/providers/sportsref.js
// Sports Reference (basketball-reference.com) adapter — primary schedule/results source.
//
// ⚠  SERVER-SIDE ONLY — Sports Reference has no public JSON API.
//    This module scrapes HTML and must be run from Node.js (seeding scripts)
//    or a Supabase Edge Function. Do NOT import this in browser-facing code.
//
// Requirements:
//   npm install node-fetch cheerio  (add to a separate server-side package.json
//   or include in the Edge Function bundle)
//
// Implements the Folio provider interface:
//   fetchTeams()  → NOT SUPPORTED (no efficiency ratings — use torvik)
//   fetchSchedule(teamName, year?)  → Schedule
//   fetchGameResults(teamName, year?)  → GameResult[]
//
// Provider interface shape:
//   Schedule: {
//     team_name, games: [{ opponent, result, score, location, week }]
//   }
//   GameResult: { team_name, opponent, result, score, date }
//
// Sports Reference URL pattern:
//   https://www.basketball-reference.com/cbb/schools/{slug}/{year}-schedule.html
//   where {slug} is the school slug, e.g. "duke" for Duke

// ── School slug map ────────────────────────────────────────────────────────
// Sports Reference uses URL slugs that don't always match team names.
// Extend this as you encounter teams with non-obvious slugs.
const TEAM_SLUG_MAP = {
  "Connecticut":              "connecticut",
  "UConn":                    "connecticut",
  "North Carolina":           "north-carolina",
  "UNC":                      "north-carolina",
  "NC State":                 "north-carolina-state",
  "Ohio State":               "ohio-state",
  "Michigan State":           "michigan-state",
  "Penn State":               "pennsylvania-state",
  "Florida State":            "florida-state",
  "Iowa State":               "iowa-state",
  "Kansas State":             "kansas-state",
  "Arizona State":            "arizona-state",
  "Colorado State":           "colorado-state",
  "San Diego State":          "san-diego-state",
  "Boise State":              "boise-state",
  "Utah State":               "utah-state",
  "Wichita State":            "wichita-state",
  "Oklahoma State":           "oklahoma-state",
  "Mississippi State":        "mississippi-state",
  "Louisiana State":          "louisiana-state",
  "LSU":                      "louisiana-state",
  "BYU":                      "brigham-young",
  "TCU":                      "texas-christian",
  "SMU":                      "southern-methodist",
  "UCF":                      "central-florida",
  "UAB":                      "alabama-birmingham",
  "UNLV":                     "nevada-las-vegas",
  "VCU":                      "virginia-commonwealth",
  "USC":                      "southern-california",
  "Ole Miss":                 "mississippi",
  "Miami":                    "miami-fl",
  "Miami (FL)":               "miami-fl",
  "Saint Mary's":             "saint-marys-ca",
  "Saint Joseph's":           "saint-josephs",
  "St. John's":               "st-johns-ny",
  "St. Bonaventure":          "st-bonaventure",
};

function teamToSlug(teamName) {
  if (TEAM_SLUG_MAP[teamName]) return TEAM_SLUG_MAP[teamName];
  // Default: lowercase, replace spaces with hyphens, strip punctuation
  return teamName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

const SPORTSREF_BASE = "https://www.basketball-reference.com/cbb/schools";

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Sports Reference does not provide efficiency ratings.
 */
export async function fetchTeams() {
  throw new Error(
    "sportsref provider does not support fetchTeams. " +
    "Use torvik for efficiency rating data."
  );
}

/**
 * Fetch a team's full schedule from Sports Reference for a given season.
 * SERVER-SIDE ONLY — requires cheerio for HTML parsing.
 *
 * @param {string} teamName - Team name as used in the Folio app
 * @param {number} year     - Season end year (e.g. 2025 for 2024-25)
 * @returns {Promise<Object>} Schedule in provider interface shape
 */
export async function fetchSchedule(teamName, year = new Date().getFullYear()) {
  // Dynamic import so this module doesn't break if cheerio isn't installed
  let cheerio;
  try {
    cheerio = await import("cheerio");
  } catch {
    throw new Error(
      "sportsref adapter requires cheerio. " +
      "Run: npm install cheerio  (in your server-side scripts package)"
    );
  }

  const slug = teamToSlug(teamName);
  const url  = `${SPORTSREF_BASE}/${slug}/${year}-schedule.html`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Folio-CBB-App/1.0 (non-commercial; mjsilcox121@gmail.com)",
      "Accept":     "text/html",
    },
  });

  if (res.status === 404) {
    throw new Error(
      `Sports Reference: team not found at ${url}. ` +
      `Check the slug for "${teamName}" or add it to TEAM_SLUG_MAP.`
    );
  }
  if (!res.ok) {
    throw new Error(`Sports Reference fetch failed: ${res.status} — ${url}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const games = [];

  // Sports Reference schedule table id: "schedule"
  $("#schedule tbody tr").each((_, row) => {
    const cells = $(row).find("td, th");
    if (!cells.length || $(row).hasClass("thead")) return;

    // Column positions in the schedule table (may shift if SR updates their layout)
    const dateStr  = $(row).find("td[data-stat='date_game']").text().trim();
    const location = parseLocation($(row).find("td[data-stat='game_location']").text().trim());
    const opponent = $(row).find("td[data-stat='opp_name']").text().trim();
    const result   = parseResult($(row).find("td[data-stat='game_result']").text().trim());
    const pts      = $(row).find("td[data-stat='pts']").text().trim();
    const oppPts   = $(row).find("td[data-stat='opp_pts']").text().trim();

    if (!opponent) return;

    const score = (pts && oppPts) ? `${pts}-${oppPts}` : null;

    games.push({
      opponent,
      result,
      score,
      location,
      week:   null, // week mapping done in dataProvider.js
      date:   dateStr || null,
    });
  });

  return {
    team_name: teamName,
    games,
  };
}

/**
 * Fetch only completed game results.
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

function parseLocation(raw) {
  if (!raw || raw === "") return "H";      // blank = home
  if (raw === "@")          return "A";
  if (raw === "N")          return "N";
  return "N";
}

function parseResult(raw) {
  if (!raw) return null;
  if (raw.startsWith("W")) return "W";
  if (raw.startsWith("L")) return "L";
  return null;
}
