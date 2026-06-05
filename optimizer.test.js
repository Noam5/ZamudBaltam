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

// --- optimal single-car dispatch (no flex, no 2nd car) ---
const oneCar = O.optimizeAll({ trips: OPT_TRIPS, hours: OPT_HOURS, travel: OPT_TRAVEL, defaultTol: 0 });
eq(oneCar.baltam, 19400, 'optimal 1-car Baltam = 19400');

// --- two cars with identical hours == kMachine(2) == 4050 ---
const sameHours = [0, 1, 2, 3, 4, 5].map(dw => ({ dow: dw, start: O.timeToMin(OPT_HOURS[dw].start), end: O.timeToMin(OPT_HOURS[dw].end) }));
const twoCar = O.optimizeAll({ trips: OPT_TRIPS, hours: OPT_HOURS, travel: OPT_TRAVEL, defaultTol: 0, secondaryWindows: sameHours });
eq(twoCar.baltam, 4050, 'two cars (same hours) Baltam = 4050');

// --- flexibility is monotonic and strong at ±60 ---
const flex = w => O.optimizeAll({ trips: OPT_TRIPS, hours: OPT_HOURS, travel: OPT_TRAVEL, defaultTol: w }).baltam;
const f0 = flex(0), f15 = flex(15), f30 = flex(30), f60 = flex(60);
eq(f0, 19400, 'flex ±0 == optimal 1-car');
console.log(`  flex curve: 0=${f0} 15=${f15} 30=${f30} 60=${f60}`);
eq(f0 >= f15 && f15 >= f30 && f30 >= f60, true, 'flex monotonic decreasing');
// Lock the full-state DP's outputs as the regression baseline (authoritative model).
eq(f15, 18150, 'flex ±15 stable = 18150');
eq(f30, 13975, 'flex ±30 stable = 13975');
eq(f60, 9300, 'flex ±60 stable = 9300');

console.log(ok ? '\nALL PASS' : '\nFAILURES'); process.exit(ok ? 0 : 1);
