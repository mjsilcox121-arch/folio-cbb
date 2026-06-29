// src/lib/dataProvider.js
// Data provider router — delegates to the correct adapter based on the
// active configuration in the Supabase `settings` table.
//
// Config keys (set via Supabase dashboard or admin panel):
//   efficiency_source  — "torvik" (only supported value in Phase 1)
//   schedule_source    — "sportsref" | "espn"
//   results_source     — "sportsref" | "espn"
//
// The frontend (and seeding scripts) should always call this module rather
// than importing adapters directly. That way, swapping providers is an admin
// settings change, not a code change.
//
// Usage:
//   import { getTeams, getTeam, getSchedule } from './lib/dataProvider.js'

import { supabase } from "./supabase.js";

// ── Settings cache ─────────────────────────────────────────────────────────
// Cached for the lifetime of the page load. Settings rarely change mid-session.
let _settingsCache = null;

async function getSettings() {
  if (_settingsCache) return _settingsCache;

  const { data, error } = await supabase.from("settings").select("key, value");
  if (error) throw new Error(`Failed to load provider settings: ${error.message}`);

  _settingsCache = Object.fromEntries(data.map((row) => [row.key, row.value]));
  return _settingsCache;
}

/** Clear the settings cache (call this if an admin changes a setting) */
export function clearSettingsCache() {
  _settingsCache = null;
}

// ── Adapter loader ─────────────────────────────────────────────────────────

async function loadEfficiencyProvider(source) {
  switch (source) {
    case "torvik":
      return import("./providers/torvik.js");
    default:
      throw new Error(`Unknown efficiency_source: "${source}". Expected "torvik".`);
  }
}

async function loadScheduleProvider(source) {
  switch (source) {
    case "sportsref":
      return import("./providers/sportsref.js");
    case "espn":
      return import("./providers/espn.js");
    default:
      throw new Error(`Unknown schedule_source: "${source}". Expected "sportsref" or "espn".`);
  }
}

// ── Public interface ───────────────────────────────────────────────────────

/**
 * Fetch all teams from the active efficiency provider.
 * In normal app usage, prefer reading from the Supabase `teams` table directly
 * (it's pre-seeded). Call this only from seeding/refresh scripts or Edge Functions.
 *
 * @param {number} year - Season end year
 * @returns {Promise<Array>} Array of team objects in provider interface shape
 */
export async function getTeams(year) {
  const settings = await getSettings();
  const provider = await loadEfficiencyProvider(settings.efficiency_source ?? "torvik");
  return provider.fetchTeams(year);
}

/**
 * Fetch a single team by name from the active efficiency provider.
 *
 * @param {string} teamName
 * @param {number} year
 * @returns {Promise<Object|null>}
 */
export async function getTeam(teamName, year) {
  const settings = await getSettings();
  const provider = await loadEfficiencyProvider(settings.efficiency_source ?? "torvik");
  return provider.fetchTeam(teamName, year);
}

/**
 * Fetch a team's schedule from the active schedule provider.
 * Falls back to ESPN if the primary source fails.
 *
 * @param {string} teamName
 * @param {number} year
 * @returns {Promise<Object>} Schedule in provider interface shape
 */
export async function getSchedule(teamName, year) {
  const settings       = await getSettings();
  const primarySource  = settings.schedule_source  ?? "sportsref";
  const fallbackSource = primarySource === "sportsref" ? "espn" : "sportsref";

  try {
    const primary = await loadScheduleProvider(primarySource);
    return await primary.fetchSchedule(teamName, year);
  } catch (primaryErr) {
    console.warn(
      `[dataProvider] ${primarySource} fetchSchedule failed for "${teamName}": ${primaryErr.message}. ` +
      `Falling back to ${fallbackSource}.`
    );
    const fallback = await loadScheduleProvider(fallbackSource);
    return fallback.fetchSchedule(teamName, year);
  }
}

/**
 * Fetch completed game results for a team from the active results provider.
 * Falls back to ESPN if the primary source fails.
 *
 * @param {string} teamName
 * @param {number} year
 * @returns {Promise<Array>} Array of game result objects
 */
export async function getGameResults(teamName, year) {
  const settings       = await getSettings();
  const primarySource  = settings.results_source  ?? "sportsref";
  const fallbackSource = primarySource === "sportsref" ? "espn" : "sportsref";

  try {
    const primary = await loadScheduleProvider(primarySource);
    return await primary.fetchGameResults(teamName, year);
  } catch (primaryErr) {
    console.warn(
      `[dataProvider] ${primarySource} fetchGameResults failed for "${teamName}": ${primaryErr.message}. ` +
      `Falling back to ${fallbackSource}.`
    );
    const fallback = await loadScheduleProvider(fallbackSource);
    return fallback.fetchGameResults(teamName, year);
  }
}
