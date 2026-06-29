// node scripts/debug-espn.js
// Find Duke's ESPN team ID, fetch their schedule, dump one completed game's raw shape

const teamsRes = await fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams?limit=500");
const teamsData = await teamsRes.json();
const teams = teamsData?.sports?.[0]?.leagues?.[0]?.teams ?? [];
const duke = teams.find(e => e.team.displayName.toLowerCase().includes("duke"));
console.log("Duke ESPN entry:", JSON.stringify(duke?.team, null, 2));

if (!duke) { console.log("Duke not found"); process.exit(1); }

const schedRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams/${duke.team.id}/schedule?season=2026`);
const schedData = await schedRes.json();
const events = schedData?.events ?? [];
console.log(`\nTotal events: ${events.length}`);
console.log("\nFirst event competition status (full):");
console.log(JSON.stringify(events[0]?.competitions?.[0]?.status, null, 2));
console.log("\nFirst event competitor scores:");
const comp = events[0]?.competitions?.[0];
comp?.competitors?.forEach(c => console.log(` ${c.team.displayName}: score=${c.score}, homeAway=${c.homeAway}`));
