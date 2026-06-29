// node scripts/debug-torvik.js
const res = await fetch("http://barttorvik.com/2026_team_results.json");
const raw = await res.json();
const duke = raw.find(r => String(r[1]).toLowerCase().includes("duke"));
console.log("Duke row:", duke?.slice(0, 5));
