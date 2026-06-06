// optimizer.js — pure Baltam-optimization functions (UMD: Node require + browser globals).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function timeToMin(t) { if (!t) return 0; const p = t.split(':'); return (+p[0]) * 60 + (+p[1]); }
  function endMinOf(t) { const r = timeToMin(t.endTime), s = timeToMin(t.startTime); return (r === 0 && s > 0) ? 1440 : r; }
  function dowOf(d) { return new Date(d + 'T00:00:00').getDay(); }

  function makeLookups(travel) {
    function travelTime(from, to, morning) {
      for (const e of travel) if ((e.from === from && e.to === to) || (e.from === to && e.to === from)) return morning ? e.morningMin : e.afternoonMin;
      return null;
    }
    function tripPrice(from, to) {
      for (const e of travel) if ((e.from === from && e.to === to) || (e.from === to && e.to === from)) return e.check ? 0 : (e.price || 0);
      return 0;
    }
    return { travelTime, tripPrice };
  }

  // Exact port of index.html classifyTrips → summed B/BML/B120 price (the app's current Baltam).
  function greedyBaltam(trips, hours, travel) {
    const { travelTime, tripPrice } = makeLookups(travel);
    const sorted = trips.map((t, i) => Object.assign({ _i: i }, t))
      .sort((a, b) => a.date !== b.date ? a.date.localeCompare(b.date) : a.startTime.localeCompare(b.startTime));
    const res = []; let cum = 0, total = 0; const byMonth = {}; const perTrip = [];
    for (let i = 0; i < sorted.length; i++) {
      const t = sorted[i], s = timeToMin(t.startTime), rE = timeToMin(t.endTime);
      const eDur = (rE === 0 && s > 0) ? 1440 : rE, dur = eDur - s, dw = dowOf(t.date);
      const wh = dw === 6 ? null : hours[dw];
      let code = 'Z';
      if (wh) { const ws = timeToMin(wh.start), we = timeToMin(wh.end); if (s < ws || rE > we) code = 'BML'; } else code = 'BML';
      if (code !== 'BML') {
        let pz = null; for (let j = i - 1; j >= 0; j--) if (res[j].date === t.date && res[j].code === 'Z') { pz = res[j]; break; }
        if (pz) {
          const pr = timeToMin(pz.endTime), pe = (pr === 0 && timeToMin(pz.startTime) > 0) ? 1440 : pr;
          const tm = travelTime(pz.to, t.from, s < 720);
          if (tm !== null) code = (pe - s + tm > 0) ? 'B' : 'Z';
        }
      }
      if (code === 'Z') { cum += dur; if (cum > 210 * 60) code = 'B120'; }
      const price = code === 'Z' ? 0 : tripPrice(t.from, t.to);
      res.push(Object.assign({ code, price }, t));
      perTrip.push({ ref: trips[t._i], code, price });
      if (code !== 'Z') { total += price; const m = t.date.slice(0, 7); byMonth[m] = (byMonth[m] || 0) + price; }
    }
    return { total, byMonth, perTrip };
  }

  function tolOfTrip(t, ctx) { return (ctx.tolByDoctor && ctx.tolByDoctor[t.doctor] != null) ? ctx.tolByDoctor[t.doctor] : (ctx.defaultTol || 0); }
  function singleUnit(t, ctx) { const s = timeToMin(t.startTime), e = endMinOf(t); return { trips: [t], from: t.from, to: t.to, s, e, dur: e - s, tl: tolOfTrip(t, ctx), price: ctx.lk.tripPrice(t.from, t.to), morning: s < 720, isPool: false }; }

  // Merge two compatible trips into ONE multi-stop armored run (pooling, groups of 2).
  function mergePair(a, b, ctx) {
    if (a.doctor === b.doctor) return null;
    const { travelTime, tripPrice } = ctx.lk;
    const sa = timeToMin(a.startTime), sb = timeToMin(b.startTime), morning = Math.min(sa, sb) < 720;
    let from, to, dur = null;
    if (a.from === b.from && a.to === b.to) { from = a.from; to = a.to; dur = travelTime(a.from, a.to, morning); }
    else if (a.from === b.from) { // divergent: O -> d1 -> d2 (nearest first)
      const O = a.from; const d = [a.to, b.to].sort((x, y) => (travelTime(O, x, morning) == null ? 1e9 : travelTime(O, x, morning)) - (travelTime(O, y, morning) == null ? 1e9 : travelTime(O, y, morning)));
      const l1 = travelTime(O, d[0], morning), l2 = travelTime(d[0], d[1], morning);
      if (l1 == null || l2 == null) return null; from = O; to = d[1]; dur = l1 + l2;
    } else if (a.to === b.to) { // convergent: o1 -> o2 -> D (farther first)
      const D = a.to; const o = [a.from, b.from].sort((x, y) => (travelTime(y, D, morning) == null ? 0 : travelTime(y, D, morning)) - (travelTime(x, D, morning) == null ? 0 : travelTime(x, D, morning)));
      const l1 = travelTime(o[0], o[1], morning), l2 = travelTime(o[1], D, morning);
      if (l1 == null || l2 == null) return null; from = o[0]; to = D; dur = l1 + l2;
    } else return null;
    if (dur == null) return null;
    const s = Math.min(sa, sb);
    return { trips: [a, b], from, to, s, e: s + dur, dur, tl: Math.min(tolOfTrip(a, ctx), tolOfTrip(b, ctx)), price: tripPrice(a.from, a.to) + tripPrice(b.from, b.to), morning, isPool: true };
  }

  // Build dispatch units; with ctx.pool, greedily pair compatible trips into shared runs.
  function buildUnits(dayTrips, ctx) {
    if (!ctx.pool) return dayTrips.map(t => singleUnit(t, ctx));
    const { travelTime } = ctx.lk, W = ctx.pool.W, NEAR = ctx.pool.NEAR;
    const near = (x, y, mo) => { const tm = travelTime(x, y, mo); return tm != null && tm <= NEAR; };
    const arr = dayTrips.slice().sort((a, b) => timeToMin(a.startTime) - timeToMin(b.startTime));
    const used = new Set(), units = [];
    for (const a of arr) {
      if (used.has(a)) continue;
      let bestM = null, bestB = null;
      for (const b of arr) {
        if (b === a || used.has(b) || b.doctor === a.doctor) continue;
        const mo = timeToMin(a.startTime) < 720;
        if (Math.abs(timeToMin(b.startTime) - timeToMin(a.startTime)) > W) continue;
        const compat = (a.from === b.from && a.to === b.to) || (a.from === b.from && near(a.to, b.to, mo)) || (a.to === b.to && near(a.from, b.from, mo));
        if (!compat) continue;
        const m = mergePair(a, b, ctx);
        if (m && (bestM === null || m.dur < bestM.dur)) { bestM = m; bestB = b; } // tightest pool
      }
      if (bestM) { used.add(a); used.add(bestB); units.push(bestM); }
      else { used.add(a); units.push(singleUnit(a, ctx)); }
    }
    return units;
  }

  // Dispatch a fixed unit list over primary(+secondary) car; returns {baltam, planUnits}.
  function dispatchUnits(units, wh, ws, we, wins, travelTime) {
    units = units.slice().sort((a, b) => (a.s - a.tl) - (b.s - b.tl) || a.e - b.e);
    const n = units.length;
    function place(c, prevTime, prevLoc, availStart, availEnd) {
      let lo = c.s - c.tl;
      if (prevLoc != null) { const tm = travelTime(prevLoc, c.from, c.morning); if (tm === null) return null; lo = Math.max(lo, prevTime + tm); }
      let st = Math.max(lo, c.s - c.tl, availStart);
      if (st > c.s + c.tl) return null;
      if (st + c.dur > availEnd) return null;
      return st;
    }
    const memo = new Map();
    function rec(i, t1, l1, t2, l2) {
      if (i === n) return { val: 0, plan: [] };
      const key = i + '|' + t1 + '|' + l1 + '|' + t2 + '|' + l2;
      const hit = memo.get(key); if (hit) return hit;
      const c = units[i];
      let best = rec(i + 1, t1, l1, t2, l2); best = { val: best.val, plan: best.plan }; // skip
      if (wh) {
        const st = place(c, t1, l1, ws, we);
        if (st != null) { const sub = rec(i + 1, st + c.dur, c.to, t2, l2), v = c.price + sub.val; if (v > best.val) best = { val: v, plan: [{ unit: c, car: 1, start: st }].concat(sub.plan) }; }
      }
      for (const w of wins) {
        const st = place(c, t2, l2, w.start, w.end);
        if (st != null) { const sub = rec(i + 1, t1, l1, st + c.dur, c.to), v = c.price + sub.val; if (v > best.val) best = { val: v, plan: [{ unit: c, car: 2, start: st }].concat(sub.plan) }; }
      }
      memo.set(key, best); return best;
    }
    const r = rec(0, -1, null, -1, null);
    const totalPrice = units.reduce((a, u) => a + u.price, 0);
    return { baltam: totalPrice - r.val, planUnits: r.plan };
  }

  // Per-day dispatch. With pooling, also try the paired-units layout and keep whichever
  // gives lower Baltam — so pooling can never make a day worse than not pooling.
  function optimizeDay(dayTrips, ctx) {
    const { travelTime } = ctx.lk, hours = ctx.hours;
    const dw = dowOf(dayTrips[0].date), wh = dw === 6 ? null : hours[dw];
    const ws = wh ? timeToMin(wh.start) : 0, we = wh ? timeToMin(wh.end) : 0;
    const wins = (ctx.secondaryWindows || []).filter(w => w.dow === dw);
    let best = dispatchUnits(dayTrips.map(t => singleUnit(t, ctx)), wh, ws, we, wins, travelTime);
    if (ctx.pool) { const alt = dispatchUnits(buildUnits(dayTrips, ctx), wh, ws, we, wins, travelTime); if (alt.baltam < best.baltam) best = alt; }
    const plan = [];
    for (const p of best.planUnits) for (const trip of p.unit.trips) plan.push({ trip, car: p.car, start: p.start, pooled: p.unit.isPool ? p.unit.trips.length : 1 });
    return { baltam: best.baltam, plan };
  }

  function optimizeAll(opts) {
    const ctx = { lk: makeLookups(opts.travel), hours: opts.hours, tolByDoctor: opts.tolByDoctor, defaultTol: opts.defaultTol, secondaryWindows: opts.secondaryWindows, pool: opts.pool };
    const byDate = {}; for (const t of opts.trips) (byDate[t.date] = byDate[t.date] || []).push(t);
    let baltam = 0; const plan = [];
    for (const d of Object.keys(byDate).sort()) { const r = optimizeDay(byDate[d], ctx); baltam += r.baltam; for (const p of r.plan) plan.push(p); }
    return { baltam, plan };
  }

  // Run with an unlimited 2nd car, then bucket the trips it serves into (dow,band) windows.
  function recommendWindows(opts) {
    const sec = [0, 1, 2, 3, 4, 5, 6].map(dw => ({ dow: dw, start: 0, end: 1440 }));
    const r = optimizeAll(Object.assign({}, opts, { secondaryWindows: sec }));
    const { tripPrice } = makeLookups(opts.travel);
    const band = s => s < 11 * 60 ? 'AM' : s < 14 * 60 ? 'MID' : 'PM';
    const groups = {};
    for (const p of r.plan) {
      if (p.car !== 2) continue;
      const dw = dowOf(p.trip.date), b = band(p.start), key = dw + '|' + b;
      const e = endMinOf(p.trip), price = tripPrice(p.trip.from, p.trip.to);
      const g = groups[key] || (groups[key] = { dow: dw, band: b, start: 1e9, end: 0, count: 0, price: 0 });
      g.start = Math.min(g.start, p.start); g.end = Math.max(g.end, p.start + (e - timeToMin(p.trip.startTime)));
      g.count++; g.price += price;
    }
    const windows = Object.values(groups).sort((a, b) => b.price - a.price);
    return { windows, totalPrice: windows.reduce((a, w) => a + w.price, 0) };
  }

  return { timeToMin, endMinOf, dowOf, makeLookups, greedyBaltam, optimizeDay, optimizeAll, recommendWindows };
});
