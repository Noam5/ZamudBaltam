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
    const res = []; let cum = 0, total = 0; const byMonth = {};
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
      if (code !== 'Z') { total += price; const m = t.date.slice(0, 7); byMonth[m] = (byMonth[m] || 0) + price; }
    }
    return { total, byMonth };
  }

  return { timeToMin, endMinOf, dowOf, makeLookups, greedyBaltam };
});
