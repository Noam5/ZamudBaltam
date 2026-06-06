// report_data.js — compute every figure the DOCX report needs, from the tested engine.
const fs = require('fs'), path = require('path'), dir = __dirname;
const live = JSON.parse(fs.readFileSync(path.join(dir, 'live_state.json'), 'utf8'));
const C = JSON.parse(fs.readFileSync(path.join(dir, 'classified.json'), 'utf8'));
const { OPT_TRIPS, OPT_HOURS, OPT_TRAVEL, OPT_DOCTORS } = require('./optdata');
const O = require('./optimizer');
const tt = live.travelTable;
const t2m = t => { if (!t) return 0; const p = t.split(':'); return (+p[0]) * 60 + (+p[1]); };
const HEB = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];
const dow = d => new Date(d + 'T00:00:00').getDay();
const price = (f, to) => { for (const e of tt) if ((e.from === f && e.to === to) || (e.from === to && e.to === f)) return e.check ? 0 : (e.price || 0); return 0; };
const DOC = { 'נטליה': 'נטליה', "דר' נטליה": 'נטליה', 'ד"ר נטליה': 'נטליה', 'עבד': 'עבד', 'ד"ר עבד': 'עבד', 'ד"ר לירון יורמן': 'לירון יורמן', 'ד"ר גור': 'גור', 'ד"ר סוזי אוברמן': 'סוזי אוברמן', 'ד"ר מאירסון': 'מאירסון', 'מרינה ברבשטיין': 'מרינה ברבשטיין' };
const nd = d => DOC[(d || '').trim()] || ((d || '').trim() || 'ללא');
let ALL = []; for (const a of Object.values(C)) ALL.push(...a);
const endM = t => { const r = t2m(t.endTime), s = t2m(t.startTime); return (r === 0 && s > 0) ? 1440 : r; };
const m2t = x => String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0');

const opt = (o) => O.optimizeAll(Object.assign({ trips: OPT_TRIPS, hours: OPT_HOURS, travel: OPT_TRAVEL }, o)).baltam;
const real = {}; for (const d of OPT_DOCTORS) real[d] = (d === 'נטליה') ? 15 : 30;
const poolM = { W: 40, NEAR: 40 };
const baseGreedy = O.greedyBaltam(OPT_TRIPS, OPT_HOURS, OPT_TRAVEL).total;

const levers = {
  baseGreedy,
  optimalDispatch: opt({ defaultTol: 0 }),
  flex15: opt({ defaultTol: 15 }), flex30: opt({ defaultTol: 30 }), flex60: opt({ defaultTol: 60 }),
  realNoPool: opt({ tolByDoctor: real }),
  realPool: opt({ tolByDoctor: real, pool: poolM }),
  realPoolNear20: opt({ tolByDoctor: real, pool: { W: 40, NEAR: 20 } }),
  twoCar: opt({ defaultTol: 0, secondaryWindows: [0, 1, 2, 3, 4, 5].map(d => ({ dow: d, start: t2m(OPT_HOURS[d].start), end: t2m(OPT_HOURS[d].end) })) }),
};

// recommended 2nd-car windows (with realistic flex)
const rec = O.recommendWindows({ trips: OPT_TRIPS, hours: OPT_HOURS, travel: OPT_TRAVEL, tolByDoctor: real });
const windows = rec.windows.map(w => ({ day: HEB[w.dow], band: w.band, start: m2t(w.start), end: m2t(w.end), perMo: Math.round(w.price / 4), count: w.count }));

// recurring B patterns by dow+route and by dow+doctor (normalized doctors)
const Btrips = [];
const byDate = {}; for (const r of ALL) (byDate[r.date] = byDate[r.date] || []).push(r);
for (const d of Object.keys(byDate)) {
  const day = byDate[d].slice().sort((a, b) => a.startTime.localeCompare(b.startTime));
  for (const t of day) if (t.code === 'B') Btrips.push({ d, dw: HEB[dow(d)], route: t.from + '→' + t.to, doc: nd(t.doctor), price: price(t.from, t.to) });
}
function group(keyFn) { const g = {}; for (const b of Btrips) { const k = keyFn(b); (g[k] = g[k] || { n: 0, sum: 0 }); g[k].n++; g[k].sum += b.price; } return Object.entries(g).map(([k, v]) => ({ k, n: v.n, sum: v.sum, perMo: Math.round(v.sum / 4) })).sort((a, b) => b.sum - a.sum); }
const byRoute = group(b => b.dw + ' | ' + b.route).filter(x => x.n >= 3).slice(0, 12);
const byDoctorDay = group(b => b.dw + ' | ' + b.doc).filter(x => x.n >= 2).slice(0, 10);

// BML trips
const bml = ALL.filter(r => r.code === 'BML').map(r => ({ d: r.d || '', dw: HEB[dow(r.date)], date: r.date, route: r.from + '→' + r.to, doc: nd(r.doctor), start: r.startTime, end: r.endTime, price: price(r.from, r.to) }));

// doctor breakdown: trips + baltam (B/BML) per normalized doctor
const docs = {};
for (const r of ALL) { const k = nd(r.doctor); docs[k] = docs[k] || { trips: 0, baltam: 0 }; docs[k].trips++; if (r.code !== 'Z') docs[k].baltam += price(r.from, r.to); }
const doctorTable = Object.entries(docs).map(([k, v]) => ({ doc: k, trips: v.trips, baltam: v.baltam })).sort((a, b) => b.trips - a.trips);

// counts
const counts = { trips: ALL.length, B: ALL.filter(r => r.code === 'B').length, BML: ALL.filter(r => r.code === 'BML').length, Z: ALL.filter(r => r.code === 'Z').length };

fs.writeFileSync(path.join(dir, 'report_data.json'), JSON.stringify({ levers, windows, byRoute, byDoctorDay, bml, doctorTable, counts }, null, 1));
console.log('levers:', JSON.stringify(levers));
console.log('windows:', windows.length, 'byRoute:', byRoute.length, 'byDoctorDay:', byDoctorDay.length, 'bml:', bml.length);
console.log('[wrote report_data.json]');
