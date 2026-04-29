// season2024.js — 2023-24 season aggregator
// Re-exports the existing 2023-24 data from the legacy top-level files
// so we avoid moving ~1300 lines. Other seasons live in their own files.

import { WEEKS, TEAM_HISTORY } from "../weeklyData";
import { DIVIDEND_EVENTS, EVENTS_BY_WEEK } from "../dividends";
import { SCHEDULES as HAND_CURATED } from "../schedules";
import { GENERATED_SCHEDULES } from "./generated/season2024.schedules";

// Generated entries cover every D-I team; hand-curated overrides win on overlap.
const SCHEDULES = { ...GENERATED_SCHEDULES, ...HAND_CURATED };

export const SEASON_2024 = {
  id: "2023-24",
  label: "2023-24",
  champion: "UConn",
  WEEKS,
  TEAM_HISTORY,
  SCHEDULES,
  DIVIDEND_EVENTS,
  EVENTS_BY_WEEK,
};
