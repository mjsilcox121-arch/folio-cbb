#!/usr/bin/env node
// scripts/seed-teams.js
// Seeds the Supabase `teams` table with current T-Rank ratings from Bart Torvik.
//
// Run from the repo root:
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_KEY=your-service-key \
//   node scripts/seed-teams.js
//
// Or with a .env file (install dotenv first: npm install dotenv):
//   node --env-file=.env scripts/seed-teams.js
//
// Options (set as env vars):
//   TORVIK_YEAR       - Season end year to fetch (default: current year)
//   DRY_RUN=true      - Print teams but don't write to Supabase
//   SEASON_LABEL      - Label stored in the `season` column (default: "YYYY-YY")
//
// The script uses upsert, so it's safe to re-run — it will update existing rows.

import { createClient } from "@supabase/supabase-js";
import { fetchTeams }   from "../frontend/src/lib/providers/torvik.js";

// ── Config ────────────────────────────────────────────────────────────────
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const YEAR                 = parseInt(process.env.TORVIK_YEAR ?? String(new Date().getFullYear()), 10);
const DRY_RUN              = process.env.DRY_RUN === "true";
const SEASON_LABEL         = process.env.SEASON_LABEL ?? `${YEAR - 1}-${String(YEAR).slice(2)}`;
const BATCH_SIZE           = 50; // rows per upsert batch

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(
    "ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.\n" +
    "Get the service key from: Supabase Dashboard → Settings → API → service_role key"
  );
  process.exit(1);
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🏀 Folio Team Seeder`);
  console.log(`   Season:  ${SEASON_LABEL} (year=${YEAR})`);
  console.log(`   Source:  Bart Torvik T-Rank`);
  console.log(`   Dry run: ${DRY_RUN}`);
  console.log(`   Target:  ${SUPABASE_URL}\n`);

  // 1. Fetch from Torvik
  console.log("Fetching T-Rank ratings from barttorvik.com...");
  let teams;
  try {
    teams = await fetchTeams(YEAR);
  } catch (err) {
    console.error(`Torvik fetch failed: ${err.message}`);
    process.exit(1);
  }
  console.log(`✓ Fetched ${teams.length} teams\n`);

  if (teams.length === 0) {
    console.warn("No teams returned — nothing to seed. Check the Torvik API or year parameter.");
    process.exit(0);
  }

  // 2. Attach season label
  const rows = teams.map((t) => ({ ...t, season: SEASON_LABEL }));

  // 3. Preview
  console.log("Sample (first 5 teams):");
  rows.slice(0, 5).forEach((t) => {
    console.log(
      `  ${t.name.padEnd(25)} | ${t.conference.padEnd(10)} | ` +
      `eff=${t.efficiency_rating?.toFixed(2).padStart(6)} | ` +
      `shares=${t.shares_total} | price=$${t.share_price?.toFixed(2)} | ${t.record}`
    );
  });
  console.log(`  ... and ${rows.length - 5} more\n`);

  if (DRY_RUN) {
    console.log("DRY RUN — no writes. Set DRY_RUN=false to seed.");
    return;
  }

  // 4. Upsert to Supabase in batches
  // Uses service key — bypasses RLS so it can write to the teams table.
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  let inserted = 0, updated = 0, errors = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase
      .from("teams")
      .upsert(batch, {
        onConflict: "name,season", // requires a unique constraint on (name, season)
        ignoreDuplicates: false,   // update existing rows
      })
      .select("id");

    if (error) {
      console.error(`  Batch ${Math.floor(i / BATCH_SIZE) + 1} error: ${error.message}`);
      errors += batch.length;
    } else {
      inserted += data?.length ?? batch.length;
      process.stdout.write(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(rows.length / BATCH_SIZE)} ✓\r`);
    }
  }

  console.log(`\n\nDone.`);
  console.log(`  Upserted: ${inserted} teams`);
  if (errors > 0) console.warn(`  Errors:   ${errors} teams failed — check logs above`);

  // ── Next step reminder ────────────────────────────────────────────────────
  if (errors === 0 && inserted > 0) {
    console.log(`
⚠  IMPORTANT: The upsert uses (name, season) as the conflict key.
   If you haven't already, add a unique constraint in Supabase:

     ALTER TABLE public.teams
       ADD CONSTRAINT teams_name_season_key UNIQUE (name, season);

   Or run this in the Supabase SQL Editor before seeding.
`);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
