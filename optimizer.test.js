// optimizer.test.js — run with `node optimizer.test.js`
const { OPT_TRIPS, OPT_TRAVEL, OPT_HOURS } = require('./optdata');
const O = require('./optimizer');
let ok = true;
const eq = (a, b, msg) => { if (a !== b) { ok = false; console.log(`FAIL: ${msg}  got ${a} want ${b}`); } else console.log(`PASS: ${msg}`); };

// --- greedy baseline must reproduce the app's current Baltam exactly ---
const g = O.greedyBaltam(OPT_TRIPS, OPT_HOURS, OPT_TRAVEL);
eq(g.total, 23500, 'greedy total Baltam = 23500');
eq(g.byMonth['2026-02'], 8175, 'Feb greedy = 8175');
eq(g.byMonth['2026-03'], 4375, 'Mar greedy = 4375');
eq(g.byMonth['2026-04'], 5525, 'Apr greedy = 5525');
eq(g.byMonth['2026-05'], 5425, 'May greedy = 5425');

console.log(ok ? '\nALL PASS' : '\nFAILURES'); process.exit(ok ? 0 : 1);
