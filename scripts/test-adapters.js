#!/usr/bin/env node
// scripts/test-adapters.js
// Quick smoke test for each data provider adapter.
// Fetches a known team and confirms it returns valid data.
//
// Run from the repo root:
//   node scripts/test-adapters.js
//
// Optional env:
//   TEST_TEAM  - team name to test against (default: "Duke")
//   TEST_YEAR  - season end year (default: current year)

import { fetchTeams as torvikFetchTeams, fetchTeam as torvikFetchTeam } from "../frontend/src/lib/providers/torvik.js";
import { fetchSchedule as espnFetchSchedule } from "../frontend/src/lib/providers/espn.js";

const TEST_TEAM = process.env.TEST_TEAM ?? "Duke";
const TEST_YEAR = parseInt(process.env.TEST_YEAR ?? String(new Date().getFullYear()), 10);

let passed = 0;
let failed = 0;

async function test(name, fn) {
  process.stdout.write(`  ${name} ... `);
  try {
    const result = await fn();
    console.log(`✓  ${result}`);
    passed++;
  } catch (err) {
    console.log(`✗  ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ── Torvik adapter tests ──────────────────────────────────────────────────
console.log(`\n── Torvik adapter (year=${TEST_YEAR}) ─────────────────────`);

await test("fetchTeams() returns an array", async () => {
  const teams = await torvikFetchTeams(TEST_YEAR);
  assert(Array.isArray(teams), "Expected array");
  assert(teams.length > 100, `Expected >100 teams, got ${teams.length}`);
  return `${teams.length} teams`;
});

await test("fetchTeams() items have required fields", async () => {
  const teams = await torvikFetchTeams(TEST_YEAR);
  const sample = teams[0];
  assert(typeof sample.name === "string" && sample.name.length > 0, "name must be a non-empty string");
  assert(typeof sample.conference === "string",                       "conference must be a string");
  assert(typeof sample.efficiency_rating === "number",                "efficiency_rating must be a number");
  assert(sample.data_source === "torvik",                             "data_source must be 'torvik'");
  assert(typeof sample.shares_total === "number" && sample.shares_total >= 1, "shares_total must be >= 1");
  assert(typeof sample.share_price === "number" && sample.share_price > 0,    "share_price must be > 0");
  return `sample team: ${sample.name}, eff=${sample.efficiency_rating}, price=$${sample.share_price}`;
});

await test(`fetchTeam("${TEST_TEAM}") returns the team`, async () => {
  const team = await torvikFetchTeam(TEST_TEAM, TEST_YEAR);
  assert(team !== null, `Team "${TEST_TEAM}" not found`);
  assert(typeof team.efficiency_rating === "number", "efficiency_rating must be a number");
  assert(team.efficiency_rating > 0, `efficiency_rating should be positive for ${TEST_TEAM}, got ${team.efficiency_rating}`);
  return `efficiency_rating=${team.efficiency_rating}, shares=${team.shares_total}, price=$${team.share_price}`;
});

await test("fetchTeams() efficiency_ratings are all valid numbers", async () => {
  const teams = await torvikFetchTeams(TEST_YEAR);
  const nullCount = teams.filter((t) => t.efficiency_rating == null).length;
  const negCount  = teams.filter((t) => t.efficiency_rating != null && t.efficiency_rating <= 0).length;
  // Negative efficiency ratings are valid — lower-tier teams have negative adj_em
  assert(nullCount < teams.length * 0.1, `Too many null efficiency_ratings: ${nullCount}/${teams.length}`);
  assert(nullCount + negCount < teams.length, "No teams have a valid positive efficiency rating");
  return `${nullCount} null, ${negCount} non-positive (expected for lower-tier teams) out of ${teams.length}`;
});

// ── ESPN adapter tests ────────────────────────────────────────────────────
console.log(`\n── ESPN adapter (team="${TEST_TEAM}", year=${TEST_YEAR}) ──────`);

await test(`fetchSchedule("${TEST_TEAM}") returns a schedule object`, async () => {
  const schedule = await espnFetchSchedule(TEST_TEAM, TEST_YEAR);
  assert(schedule && typeof schedule === "object",       "Expected an object");
  assert(schedule.team_name === TEST_TEAM,               "team_name mismatch");
  assert(Array.isArray(schedule.games),                  "games must be an array");
  assert(schedule.games.length > 0,                      "Expected at least one game");
  return `${schedule.games.length} games`;
});

await test("ESPN games have required fields", async () => {
  const schedule = await espnFetchSchedule(TEST_TEAM, TEST_YEAR);
  const game = schedule.games.find((g) => g.result !== null);
  assert(game, "No completed games found");
  assert(typeof game.opponent === "string" && game.opponent.length > 0, "opponent must be a string");
  assert(["W", "L"].includes(game.result),                               "result must be W or L");
  assert(["H", "A", "N"].includes(game.location),                       "location must be H, A, or N");
  return `sample: ${game.result} vs ${game.opponent} (${game.location}) ${game.score ?? ""}`;
});

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\n── Results ────────────────────────────────────────────────`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
if (failed > 0) {
  console.log(`\n  Some tests failed — check the output above for details.`);
  process.exit(1);
} else {
  console.log(`\n  All tests passed ✓`);
}
