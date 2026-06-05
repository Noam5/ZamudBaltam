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

  // Per-day dispatch: primary car (within working hours) + optional secondary car
  // (only inside its windows), each trip's pickup shiftable within ±tol. Returns
  // { baltam, plan:[{trip,car,start}] }. Earliest-feasible start; full-state memo.
  function optimizeDay(dayTrips, ctx) {
    const { travelTime, tripPrice } = ctx.lk, hours = ctx.hours;
    const tolOf = t => (ctx.tolByDoctor && ctx.tolByDoctor[t.doctor] != null) ? ctx.tolByDoctor[t.doctor] : (ctx.defaultTol || 0);
    const dw = dowOf(dayTrips[0].date), wh = dw === 6 ? null : hours[dw];
    const ws = wh ? timeToMin(wh.start) : 0, we = wh ? timeToMin(wh.end) : 0;
    const wins = (ctx.secondaryWindows || []).filter(w => w.dow === dw);
    const ts = dayTrips.map(t => { const s = timeToMin(t.startTime), e = endMinOf(t); return { t, s, e, dur: e - s, tl: tolOf(t), price: tripPrice(t.from, t.to), morning: s < 720 }; })
      .sort((a, b) => (a.s - a.tl) - (b.s - b.tl) || a.e - b.e);
    const n = ts.length;
    // earliest start for cand on a car whose last trip ended at (prevTime,prevLoc), within [availStart,availEnd]
    function place(cand, prevTime, prevLoc, availStart, availEnd) {
      let lo = cand.s - cand.tl;
      if (prevLoc != null) { const tm = travelTime(prevLoc, cand.t.from, cand.morning); if (tm === null) return null; lo = Math.max(lo, prevTime + tm); }
      let st = Math.max(lo, cand.s - cand.tl, availStart);
      if (st > cand.s + cand.tl) return null;
      if (st + cand.dur > availEnd) return null;
      return st;
    }
    const memo = new Map();
    function rec(i, t1, l1, t2, l2) {
      if (i === n) return { val: 0, plan: [] };
      const key = i + '|' + t1 + '|' + l1 + '|' + t2 + '|' + l2;
      const hit = memo.get(key); if (hit) return hit;
      const c = ts[i];
      let best = rec(i + 1, t1, l1, t2, l2); best = { val: best.val, plan: best.plan }; // skip
      if (wh) {
        const st = place(c, t1, l1, ws, we);
        if (st != null) { const sub = rec(i + 1, st + c.dur, c.t.to, t2, l2), v = c.price + sub.val; if (v > best.val) best = { val: v, plan: [{ trip: c.t, car: 1, start: st }].concat(sub.plan) }; }
      }
      for (const w of wins) {
        const st = place(c, t2, l2, w.start, w.end);
        if (st != null) { const sub = rec(i + 1, t1, l1, st + c.dur, c.t.to), v = c.price + sub.val; if (v > best.val) best = { val: v, plan: [{ trip: c.t, car: 2, start: st }].concat(sub.plan) }; }
      }
      memo.set(key, best); return best;
    }
    const r = rec(0, -1, null, -1, null);
    const totalPrice = ts.reduce((a, b) => a + b.price, 0);
    return { baltam: totalPrice - r.val, plan: r.plan };
  }

  function optimizeAll(opts) {
    const ctx = { lk: makeLookups(opts.travel), hours: opts.hours, tolByDoctor: opts.tolByDoctor, defaultTol: opts.defaultTol, secondaryWindows: opts.secondaryWindows };
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
