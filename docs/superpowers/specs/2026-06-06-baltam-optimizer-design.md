# Baltam Optimizer Tab — Design Spec

**Date:** 2026-06-06
**Component:** New tab in `index.html` (single-file app), titled **"ייעול בלת״ם"**
**Status:** Awaiting user review

---

## 1. Purpose

Give the user an interactive "what-if" tool to see how much of the per-trip Baltam
bill can be eliminated, and by which lever, **before** committing to any real-world
change (moving a doctor's appointment, or paying for a part-time second armored car).

It answers three questions concretely, in shekels:

1. How low does Baltam go if the single Zamud car is **dispatched optimally**?
2. How low does it go if specific doctors' pickups can **shift by ±N minutes**?
3. What does a **part-time second armored car** save, in which windows, and what is
   the break-even price?

The metric being minimized is the app's existing **Baltam ₪** figure (sum of the
per-trip price of every B / BML / B120 trip). This was confirmed with the user: the
₪52,000/mo is a flat retainer for the dedicated car; Orzion bills per-trip on top, and
the goal is to drive those per-trip (Baltam) trips toward zero.

## 2. Background facts (validated against 4 months of real invoices)

All figures are over Feb–May 2026 (312 trips), scored with the app's exact engine and
the live price table / working-hours window pulled from the Google Apps Script backend.

- Current Baltam (app's greedy classification): **₪23,500 / 4mo ≈ ₪5,875/mo**
  (per month: Feb 8,175 · Mar 4,375 · Apr 5,525 · May 5,425).
- **100% of overlap (B) conflicts are between *different* doctors** competing for the one
  car at the same time — never a doctor's own trips overlapping.
- Optimal single-car dispatch: **₪19,400 / 4mo ≈ ₪4,850/mo** (saves ~₪1,025/mo, free).
- Two-car optimum: **₪4,050 / 4mo ≈ ₪1,013/mo** → a 2nd car is worth up to ~₪3,840/mo.
- Appointment flexibility (single car, global tolerance), Baltam over 4mo:
  ±0 → 19,400 · ±15 → 17,825 · ±30 → 12,850 · ±60 → 2,350.
- Hours lever is nearly exhausted and costs extra per hour → **out of scope** for this tab.

These numbers are the regression targets for the unit tests in §7.

## 3. Data (embedded, read-only)

The tab is fully self-contained and **does not** read or write the app's live `trips`,
`travelTable`, `workingHours`, or call `saveData`. It embeds three constants in the
page script, generated at build time from `live_state.json` + `classified.json`:

- `OPT_TRIPS` — the 312 Feb–May trips: `{date, from, to, startTime, endTime, doctor}`.
  - Locations already alias-normalized.
  - **Doctor names normalized** via a build-time map that merges variants:
    `נטליה|דר' נטליה|ד"ר נטליה → נטליה`, `עבד|ד"ר עבד → עבד`,
    `ד"ר לירון יורמן → לירון יורמן`, `ד"ר גור → גור`, `ד"ר סוזי אוברמן → סוזי אוברמן`,
    `ד"ר מאירסון → מאירסון`, `מרינה ברבשטיין → מרינה ברבשטיין`, `'' → (ללא רופא)`.
- `OPT_TRAVEL` — the live travel table (78 rows: `from,to,morningMin,afternoonMin,check,price`),
  **plus the 4 currently-missing routes added** so every trip prices and chains correctly:
  `ביה"ח מאיר כפ"ס ↔ אלפי מנשה` and `צור יצחק נחל צלמון 33 ↔ אלפי מנשה`
  (times/prices to be confirmed; default to the כפר סבא/צור יצחק equivalents).
- `OPT_HOURS` — the live working-hours window (per day-of-week start/end), used to decide
  whether a trip is in-hours (primary-car eligible). Fixed; not a user control in v1.

A caption shows: "מבוסס על 312 נסיעות אמיתיות, פברואר–מאי 2026."

## 4. Controls (left panel)

1. **Smart dispatch** (checkbox, default ON) — governs only the **Optimized** figure: when ON,
   the single car is assigned by the §5 optimizer; when OFF, the dispatch lever is not applied
   (the one-car assignment falls back to the app's greedy `classifyTrips`). The headline
   **Baseline** is always the greedy current figure (₪23,500), so this isolates the "free"
   dispatch lever (₪23,500 → ₪19,400).

2. **Per-doctor flexibility** — one row per doctor, each with a ± tolerance selector
   `{0, 15, 30, 60}` minutes. Preset buttons set them all at once:
   - *ללא* → all 0
   - *שמרני* → all 15
   - *מציאותי* (default) → Natalia 15, everyone else 30
   - *אגרסיבי* → all 60

   Tolerance means a pickup may be scheduled within `[orig − tol, orig + tol]`. (Symmetric model:
   "+tol" = the doctor waits, which the user confirmed Natalia tolerates; "−tol" assumes the
   doctor/patient can be ready earlier — the softer assumption, which is why mid-tolerance
   results are labeled "אומדן".)

3. **Second-car windows** — a table of `(day · start · end · ₪/mo · #trips · [✓])` rows.
   - Auto-populated by the recommender (§5) with the windows the 2nd car actually uses.
   - Each row has an enable checkbox; start/end are editable; an "+ הוסף חלון" row lets the
     user add a custom window to test a real quote.
   - A summary line shows total 2nd-car hours/week and the break-even (₪/mo and ₪/hr).

Any control change re-runs the optimizer and re-renders the outputs (synchronous, <50ms).

## 5. Computation model (pure functions, unit-tested before embedding)

All logic lives in pure functions with no DOM access, so they can be tested in Node and
then embedded verbatim. Helpers (`timeToMin`, `lookupTravelTime`, `lookupTripPrice`,
`endMin` with the 00:00→1440 rule, morning = start<12:00) are ported exactly from
`index.html` to guarantee identical pricing/feasibility semantics.

**`greedyBaltam(trips, hours)`** — the app's exact `classifyTrips`, summing B/BML/B120 price.
Used for the baseline when Smart-dispatch is OFF. Regression target: ₪23,500.

**`optimizeDay(dayTrips, {hours, tolByDoctor, secondaryWindows})`** → `{baltam, served, assign}`
Per-day dispatch with up to two cars and flexible starts:
- Sort trips by earliest-allowed start (`orig − tol`).
- Each trip may be served by **car1 (primary)** — only if its chosen `[start,end]` stays
  within `hours[dow]` — or by **car2 (secondary)** — only if `[start,end]` lies fully inside
  an enabled secondary window — or left **unserved** (its price adds to Baltam).
- Consecutive trips on the same car must satisfy deadhead feasibility:
  `prev.end + travel(prev.to, next.from) ≤ next.start`, with `next.start` chosen as the
  earliest feasible value inside `[orig − tol, orig + tol]`.
- DP state `(i, last1, last2)` = index reached and the last trip index served on each car;
  memoized. Value maximized = Σ price of served trips (= Baltam avoided). With small days
  (≤ ~16 trips) this is fast and exact for the assignment given the earliest-feasible-start rule.

**`optimizeAll(opts)`** — runs `optimizeDay` per date, returns total Baltam + the full list of
served/unserved trips with which car served each.

**`recommendWindows(tolByDoctor, hours)`** — runs `optimizeAll` with one all-day secondary
window (06:00–24:00) every day, collects the trips car2 served, buckets them by
`(day-of-week, time band)` into contiguous windows, and returns each window's span, ₪, and
trip count. These become the editable rows in control #3.

**Break-even** — Σ enabled-secondary-window hours per representative week; report the Baltam
removed by the 2nd car as ₪/mo and ₪ per 2nd-car-hour, with the line
"כדאי אם רכב משני בחלונות אלו עולה פחות מ-₪X לחודש".

> Note: the earlier exploratory `flexDay` used a coarser `(i, last)` memo; this unified
> `(i, last1, last2)` DP is the authoritative implementation. The ±0/±60 corners
> (19,400 / 2,350) are exact regression anchors; ±15/±30 may refine by a small amount, and
> the tests will assert the values this DP actually produces (documented in the test file).

## 6. Outputs (right panel)

- **Headline summary bar** (mirrors the green summary bar elsewhere): Baseline Baltam,
  Optimized Baltam, Saved ₪, Saved %. Each shown both per-4-months and per-month.
- **Lever attribution** — incremental ₪ saved by (a) smart dispatch, (b) flexibility,
  (c) second car, computed by switching each lever on in that **fixed order** from the baseline.
  Attribution is order-dependent (the levers overlap); the order is stated in the UI so the
  numbers are reproducible, and the three always sum to the headline Saved ₪.
- **Second-car break-even** line (from §5).
- **Rescued-trips table** — the specific trips that move from Baltam→served under the current
  settings: `# · date · day · from→to · doctor · ₪ · rescued-by (dispatch / flex / car2)`.
  Reuses the existing Excel-style table CSS.

## 7. Testing

A Node test file `optimizer.test.js` (run with `node optimizer.test.js`, exit non-zero on
failure — same pattern as the existing `export_test.js`) imports the pure module and asserts:

- `greedyBaltam(OPT_TRIPS, OPT_HOURS)` === 23500, and the four monthly subtotals.
- `optimizeAll` with no flexibility / no 2nd car === 19400 (smart-dispatch baseline).
- `optimizeAll` with global tolerance 0/60 === 19400 / 2350; 15 and 30 asserted to the DP's
  own output (recorded once verified sane and monotonic decreasing).
- `optimizeAll` with an unlimited 2nd car === 4050.
- `recommendWindows` returns the expected hot windows (Fri AM, Mon AM+PM, Sun AM+MID, Fri MID)
  with ₪ within tolerance of the §2 figures.

The pure module is shared: the test requires it as a CommonJS module; the tab embeds the
identical function bodies. (Build step: a small generator writes both the embedded constants
and keeps the function source in one place to avoid drift — see §8.)

## 8. Build & integration

- `gen_optdata.js` — reads `live_state.json` + `classified.json`, applies the doctor map and
  the 4 route additions, and emits `optdata.js` (the three constants) for both the Node test
  and for pasting into the tab.
- `optimizer.js` — the pure functions (§5). Tested by `optimizer.test.js`.
- Integration into `index.html`:
  - Add a tab button `ייעול בלת״ם` after `גאנט נסיעות`.
  - Add a `<div id="tab-opt" class="tab-content">` with the left-controls / right-results layout
    (reusing `.travel-layout`, `.alias-panel`, `.summary-bar`, table CSS).
  - Inline `optdata.js` constants + `optimizer.js` functions + a `renderOpt()` that wires
    controls → compute → DOM. `renderOpt()` is added to the tab-switch handler (lazy: compute on
    first open) so it never affects load of the other tabs.
- No change to existing functions, state, or the backend payload.

## 9. Non-goals (v1)

- Does not edit or save trips, and does not change any other tab.
- Hours-extension is not a lever here (marginal value, costs extra per hour — handled as advice).
- No per-trip (as opposed to per-doctor) flexibility.
- No automatic appointment-rescheduling proposal beyond showing which trips a given tolerance rescues.
- No server/cloud persistence of optimizer settings (they reset on reload).

## 10. Alternatives considered

- **Operate on the live loaded trips** instead of a bundled dataset — rejected by the user; the
  live `trips` is usually empty (imported per month) so there'd be nothing to optimize, and the
  4-month set is what makes the analysis rich.
- **Global single flexibility slider** instead of per-doctor — rejected by the user; per-doctor
  matches reality (Natalia is the fixed anchor; others differ).
- **Read-only auto-recommended windows** vs editable — user chose editable so a real 2nd-car
  quote can be tested against actual windows.
- **ILP/min-cost-flow solver** for exact multi-car+flex optimum — overkill for ≤16 trips/day; the
  earliest-feasible-start DP is fast, explainable, and matches the validated corner numbers.

## 11. Risks

- **Doctor-name normalization gaps** — a missed variant would split a doctor's flexibility row.
  Mitigation: the generator prints the distinct normalized doctors for eyeball check.
- **DP approximation on ±15/±30** — mid-tolerance numbers are indicative, not a guarantee; the UI
  labels results "אומדן" (estimate). Corners are exact.
- **Missing-route assumptions** — the 4 added routes use proxy times/prices until confirmed; flagged
  in the caption.
- **Saturday / out-of-hours** — only a secondary window covering that time can rescue such trips;
  handled naturally by the model.

## 12. Addendum (2026-06-06): Pooling lever added

After the user confirmed two *different* doctors may share one armored car freely, with a
detour/wait tolerance of ~30–40 min, a **4th lever — ride-pooling — was added** (was a v1
non-goal in §9; superseded). The dispatch DP now runs over **units**, where a unit is either a
single trip or a **merged 2-doctor run** (divergent `O→D1→D2`, convergent `O1→O2→D`, or
identical route). Pooling pairs are formed greedily preferring the **tightest** (smallest extra
detour) merge; each day is dispatched **both** pooled and un-pooled and the lower-Baltam result
is kept, so pooling can never make a day worse (monotonic). UI: a toggle + a "max detour"
selector (20/30/40 min, default 40); attribution shows the four levers
(dispatch · flexibility · pooling · 2nd-car) summing to the headline.

**Measured value:** on the validated dataset, pooling removes ~₪1,200/4mo (≈ **₪300/mo**) *on top
of* smart-dispatch + realistic flexibility. It is the smallest lever — the dominant Baltam cost
(Natalia's Monday אלון מורה runs) is a remote solo destination that can never pool. Regression
anchors (greedy 23,500 · 1-car 19,400 · 2-car 4,050 · flex curve) are unchanged because the
no-pool path is identical when `pool` is unset.
