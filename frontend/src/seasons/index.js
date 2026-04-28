// seasons/index.js — Season registry and helpers
// Each season exports a uniform shape: { id, label, champion, WEEKS,
// TEAM_HISTORY, SCHEDULES, DIVIDEND_EVENTS, EVENTS_BY_WEEK }.

import { SEASON_2024 } from "./season2024";
import { SEASON_2023 } from "./season2023";
import { SEASON_2018 } from "./season2018";
import { SEASON_2014 } from "./season2014";

// Ordered newest-first for the dropdown.
export const SEASONS = [SEASON_2024, SEASON_2023, SEASON_2018, SEASON_2014];

export const SEASONS_BY_ID = Object.fromEntries(SEASONS.map((s) => [s.id, s]));

export const DEFAULT_SEASON_ID = SEASON_2024.id;

export function getSeason(id) {
  return SEASONS_BY_ID[id] ?? SEASON_2024;
}

// Schedule helpers — accept a SCHEDULES map so they can work for any season.
export function getGamesUpToWeek(schedules, team, currentWeek) {
  return (schedules[team] || []).filter((g) => g.week <= currentWeek);
}
export function getGamesAfterWeek(schedules, team, currentWeek) {
  return (schedules[team] || []).filter((g) => g.week > currentWeek);
}
export function getGamesForWeek(schedules, team, week) {
  return (schedules[team] || []).filter((g) => g.week === week);
}

// ── Dividend rules ──────────────────────────────────────────────────────────
// Canonical event types and their default base values.
// Settings can override these values; the App computes:
//   payout = (override ?? rule.value) * multiplier * sharesOwned
export const DIVIDEND_RULES = [
  { key: "win_game",                label: "Wins a game",                          value: 1   },
  { key: "win_top25",               label: "Wins vs top-25 team",                  value: 5   },
  { key: "win_mte",                 label: "Wins multi-team tournament",           value: 10  },
  { key: "win_outright_league",     label: "Wins outright league title",           value: 30  },
  { key: "win_contested_league",    label: "Wins contested league title",          value: 20  },
  { key: "win_league_tournament",   label: "Wins league tournament title",         value: 15  },
  { key: "make_ncaa",               label: "Makes the NCAA tournament",            value: 10  },
  { key: "make_other_postseason",   label: "Makes other postseason",               value: 5   },
  { key: "reach_r32",               label: "Reaches Round of 32",                  value: 10  },
  { key: "reach_s16",               label: "Reaches Sweet Sixteen",                value: 20  },
  { key: "reach_e8",                label: "Reaches Elite Eight",                  value: 40  },
  { key: "reach_f4",                label: "Reaches Final Four",                   value: 80  },
  { key: "ncaa_runner_up",          label: "NCAA Championship runner-up",          value: 100 },
  { key: "win_ncaa",                label: "Wins NCAA Championship",               value: 150 },
  { key: "win_other_postseason",    label: "Wins other postseason tournament",     value: 30  },
];

// Fuzzy-match an event's prose label to a rule key. The legacy event entries
// use varied wording (e.g. "Wins Big East tournament title"), so we map by
// keyword rather than exact match.
export function ruleKeyForEventLabel(label) {
  const s = label.toLowerCase();
  if (s.includes("ncaa championship") && s.includes("runner")) return "ncaa_runner_up";
  if (s.includes("wins ncaa championship") || s.includes("national championship")) return "win_ncaa";
  if (s.includes("final four")) return "reach_f4";
  if (s.includes("elite eight")) return "reach_e8";
  if (s.includes("sweet sixteen")) return "reach_s16";
  if (s.includes("round of 32")) return "reach_r32";
  if (s.includes("makes the ncaa") || s.includes("make ncaa")) return "make_ncaa";
  if (s.includes("makes other") || s.includes("nit") || s.includes("cbi")) return "make_other_postseason";
  if (s.includes("wins other postseason") || s.includes("nit champion")) return "win_other_postseason";
  if (s.includes("tournament title") || s.includes("tournament")) {
    // tournament title wins (conference tournaments)
    if (s.includes("title")) return "win_league_tournament";
    if (s.includes("multi-team")) return "win_mte";
    return "win_league_tournament";
  }
  if (s.includes("outright league")) return "win_outright_league";
  if (s.includes("contested league")) return "win_contested_league";
  if (s.includes("top-25")) return "win_top25";
  if (s.includes("wins a game")) return "win_game";
  return null;
}
