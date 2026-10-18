# Demo 2 — GitHub issues: Feature 1 (feasibility on sliders), Plot 2 (Morris screening) and Plot 3 (parallel coordinates + Pareto)

Seven issues: two for Feature 1, two for Plot 2, three for Plot 3. Paste each `##` section as one GitHub issue.
Shared conventions for all of them (agree these first):

- **Bounds shape** everywhere: `{ "<param>": [lo, hi] }`.
- **Status vocabulary**: `converged`, `max_iter`, `diverged`, `error` (solver), plus `constraint` (violates C1–C6, a design rule, not a solver failure). Map today's values in one helper `status_class()` in `backend/app/services/evtol_model.py`: `Success → converged`, `NotConverged → max_iter`, `ValueError → diverged`, anything else `→ error`.
- **New routes** go in both `backend/app/api/paths.py` and `frontend/shared/api/endpoints.js`; `tests/test_route_contract.py` fails if they drift.
- **Throughput**: since geometry memoization in `FastAircraft`, one Archer sizing takes ~0.1 s. Measured on a 14-core Windows laptop: ~23 designs/s with 4 workers and ~45 designs/s with 13. The budgets below assume the conservative 16 designs/s; time the first version of each endpoint and adjust `resolution`, `r` and the caps. Failed designs diverge early (iteration 14–19), so they cost less than converged ones.
- **Streaming**: the feasibility endpoint (F1-1) returns NDJSON (`application/x-ndjson`, one JSON object per line). Send the header `X-Accel-Buffering: no` so nginx doesn't hold the stream until it ends.

---

## F1-1 · [Backend] `POST /api/v1/evtol/feasibility`: feasible range of each slider around the current design

**Labels:** `backend` `demo2` `feature-1`  ·  **Depends on:** nothing

### What it answers
For each parameter *p*: **with every other input held at its current value, which values of *p* give a design that closes?** This is a 1-D slice through the current design, one per slider.

Key property for caching: the slice for *p* doesn't depend on *p*'s own value. While the user drags *p*, *p*'s shading stays valid and only the other 11 slices go stale.

### Slider range (already in the catalogue, nothing to pick)
Every parameter in `backend/app/params/evtol_parameters.json` now has two ranges:
- `min`/`max`, the **study box**: the hand-picked example box that `pipelines/lhs.py` samples for ensembles, Morris and the demo's ready-made runs.
- `limit_min`/`limit_max`, the **slider range**: about 0.25× to 2× the Archer Midnight value, rounded to the step. The reserve range is widened to 300 s so it contains the study box. These are starting presets, not physical limits. Whether a design closes inside them is exactly what this endpoint finds out.

| Parameter | Start (Archer) | Slider range | Study box |
|---|---|---|---|
| payload_kg | 453 | 115–905 | 350–550 |
| cruise_s | 1900 | 475–3800 | 1500–2100 |
| reserve_cruise_s | 112 | 30–300 | 100–300 |
| wingspan_m | 15.24 | 3.8–30.5 | 13–17 |
| d_value_m | 15.24 | 3.8–30.5 | 13–17 |
| fuselage_l_m | 9.0 | 2.2–18.0 | 7.5–10 |
| fuselage_w_m | 1.6 | 0.40–3.20 | 1.4–1.8 |
| horiz_tail_vol_coeff | 0.7 | 0.18–1.40 | 0.6–0.8 |
| vert_tail_vol_coeff | 0.05 | 0.012–0.100 | 0.04–0.06 |
| lift_rotor_count | 6 | 2–12 | 5–7 |
| rotor_diameter_m | 2.0 | 0.50–4.00 | 1.8–2.3 |
| batt_spec_energy_w_h_p_kg | 256 | 65–510 | 240–300 |

Some baselines sit outside the slider range (for example NASA TR: reserve 1200 s, battery 650 Wh/kg; EHang: tail coefficients 0). For those, the effective range is the slider range widened just enough to include the baseline's value: `[min(limit_min, v0), max(limit_max, v0)]`.

### Request
```json
{
  "baseline": "Archer_Midnight",
  "overrides": { "batt_spec_energy_w_h_p_kg": 240 },
  "parameters": null,
  "priority": ["batt_spec_energy_w_h_p_kg"],
  "resolution": 13,
  "refine": 3
}
```
`parameters` defaults to all 12. `priority` lists the slices to stream first (the frontend sends the slider the user just moved). `resolution` is the number of grid points across the effective slider range; integer parameters use every integer instead. `refine` is the number of bisection steps at each status change.

### Response: NDJSON, one line per parameter, then a summary line
```json
{"param":"batt_spec_energy_w_h_p_kg","limit":[65,510],"current":240,
 "constraint":[],
 "segments":[{"lo":65,"hi":247.5,"status":"diverged","reason":"MTOW grew every iteration (last change +38 kg)."},
             {"lo":247.5,"hi":510,"status":"converged"}],
 "feasible":[[247.5,510]],
 "points":[{"value":65,"status":"diverged","mtow_kg":null,"iterations":17}]}
{"done":true,"n_runs":231,"elapsed_s":14.6,"cached":4}
```

### Algorithm (per parameter, all parameters batched through `runner.map` together)
1. **Analytic constraints first, zero solver runs.** Solve C1–C6 for *p* with the others fixed. Example: wingspan must satisfy `rotor_d·n + (n−2)·0.1 ≤ wingspan ≤ d_value`. Return those intervals in `constraint` (with the constraint id) and mark the values outside them `constraint` without sizing them.
2. **Coarse scan.** Size `resolution` evenly spaced values with `size_summary`.
3. **Refine edges.** For each pair of neighbouring points whose status differs, bisect `refine` times. Batch all bisection steps of one round into one `runner.map` call.
4. **Merge** into contiguous `segments`, keep the first solver message of each failed segment as its `reason`, and list the converged segments in `feasible`.

Budget: 12 × 13 = 156 coarse runs plus about 12 × 2 × 3 = 72 refinement runs ≈ 230 runs ≈ 15 s cold. Cut the wait three ways:
- **Stream** each parameter's line as soon as it's done, `priority` first, so the slider being edited is shaded in about 1–2 s.
- **Cache** each slice in `RunStore` under `sha256(baseline, other-11 values, p, resolution, refine)`. Also cache `size_summary` results by config hash, because neighbouring slices share many points.
- **Cancel**: between `runner.map` rounds, check `await request.is_disconnected()` and stop when the browser has aborted.
- **Watch the slider ends.** A one-off scan of 550 points across the 0.25×–2× presets took far longer per point than the study-box runs, because designs near a boundary run to the 150-iteration cap. Give each point a short timeout (it counts as `max_iter`) and don't let one slow point hold back a slice's line.

### Tasks
- [ ] `apply_overrides()` validates `/size`, `/sweep` and `/feasibility` against the effective slider range instead of the study box. `/ensemble` and `/screening` keep the study box. Today a slider value outside the study box returns 422, so this has to land before the wider sliders are usable.
- [ ] Remove the "outside the study range" note: it no longer applies.
- [ ] `status_class()` helper (see conventions) and an analytic `constraint_interval(config, key)` next to `check_constraints()` in `evtol_model.py`.
- [ ] `services/feasibility.py` with the scan / refine / merge logic as pure functions (they take a `size_fn`, so tests can pass a fake solver).
- [ ] The route in `api/evtol.py` returning `StreamingResponse(..., media_type="application/x-ndjson", headers={"X-Accel-Buffering": "no"})`, the `FeasibilityRequest` schema, and `EVTOL_FEASIBILITY` in `paths.py` + `endpoints.js`.
- [ ] Tests:
  - With a fake solver that fails below x = 3, the merged boundary lands within one refinement step of 3.
  - Archer baseline: every current value lies inside a `feasible` segment.
  - Wingspan's `constraint` interval equals the C1/C6 closed form.
  - A second identical request is served entirely from cache (`cached == 12`).
  - The study box lies inside `[limit_min, limit_max]` for every parameter, and `/size` accepts a value at each slider end.

### Done when
- The first (priority) line arrives in ≤ 2 s, and all 12 cold slices in ≤ 20 s at 4 workers.
- A fully cached request returns in < 200 ms.
- Closing the browser tab stops the work.

---

## F1-2 · [Frontend] Feasibility shading on the sliders, and the reasons banner at the top of the panel

**Labels:** `frontend` `demo2` `feature-1`  ·  **Depends on:** F1-1 for the data and the wider `/size` validation. The slider presets are already in the catalogue, so start now against a mocked NDJSON file.

### What the user sees
- Each slider's track is coloured by segment: **converged** = neutral/green, **diverged / max_iter** = red, **constraint** = amber with hatching, **not yet computed** = pulsing grey. A stale slice (the design changed since it was computed) shows dimmed until its new line arrives.
- If the thumb sits in a red or amber segment, the row gets an `is-infeasible` class: red thumb and red label marker.
- Hovering the track shows a tooltip such as `2.40–2.60 m · diverges: MTOW grew every iteration`.
- **The warning list moves from the bottom of the panel to the top**, directly under the baseline picker and sticky while the inputs scroll. It explains *why* the design won't close and how to fix it, one item per cause:
  > **Battery specific energy** 240 Wh/kg is below the closing range (≥ 247.5 Wh/kg) for this payload and cruise time. evtolpy diverged: MTOW grew every iteration. **[Move to 250]**

  > **C6** 6 rotors of 2.2 m need 13.6 m of span; wingspan is 13.0 m. Raise wingspan to ≥ 13.6 m or lower rotor diameter to ≤ 2.1 m. **[Fix wingspan]**

  Sources, merged and de-duplicated: live C1–C6 (`constraintWarnings()`, extended with the fix values from the analytic interval), the feasibility slices (current value outside `feasible`), and the last `/size` 422 message. When nothing is wrong, show one compact line: "Design closes · all 12 inputs inside their feasible ranges".

### Tasks
- [ ] `index.html`: move `#constraint-warnings` above `#param-form`, rename it `#feasibility-banner`, keep `aria-live="polite"`.
- [ ] `shared/api/client.js`: add `apiStream(url, body, { signal, onLine })` (fetch → `body.getReader()` → `TextDecoder` → split on `\n` → `JSON.parse` each line).
- [ ] New `demo2/scripts/feasibility.js`: debounce 600 ms after the last change, abort the previous stream, send `priority = [lastChangedKey]`, keep a `Map<key, slice>` with a `stale` flag, and call `form.setFeasibility(key, slice)` per line.
- [ ] `demo2/scripts/form.js`:
  - Slider `min`/`max` come from `limit_min`/`limit_max`, widened to include the loaded baseline's value. The slider starts at the baseline value (Archer by default).
  - Add `setFeasibility(key, slice)`, which builds a CSS `linear-gradient` from the segments and sets it as `--track` on the slider.
  - The "outside the study range" note goes away. Optionally, show the study box as two small ticks under the track.
- [ ] `demo2/stylings/demo2.css`: style `::-webkit-slider-runnable-track` and `::-moz-range-track` with `background: var(--track)`, plus the `is-infeasible`, stale and pending states and the sticky banner. Colours must pass in light and dark themes.
- [ ] "Move to …" / "Fix …" buttons call `form.setValues({ key: nearestFeasible + one step })`.

### Done when
- On Archer, every track is shaded within 20 s and the edited slider within 2 s.
- Dragging battery specific energy below its boundary turns the thumb red and puts the reason at the top of the panel before **Size design** is pressed.
- The fix button moves the value into the feasible range, and sizing then succeeds.
- Keyboard and screen-reader users get the same reasons from the banner (shading is not the only signal).

---

## M2-1 · [Backend] `POST /api/v1/evtol/screening`: Morris elementary effects

**Labels:** `backend` `demo2` `plot-2`  ·  **Depends on:** nothing (it samples the study box)

### Why
The Sensitivity tab moves each input ±10% around one design. Morris screening covers the whole study box and gives two numbers per input and output:
- **μ\*** (mean absolute effect) measures importance.
- **σ** (spread of the effects) measures nonlinearity or interaction with other inputs.

It costs r × (k + 1) runs. With k = 12 inputs (lift and tilt rotor counts move together), r = 20 means 260 runs ≈ 16 s.

### Request / response
```json
{ "baseline": "Archer_Midnight", "r": 20, "levels": 4, "seed": 0,
  "bounds": null, "outputs": ["mtow_kg", "empty_mass_kg", "battery_mass_kg", "total_energy_kw_hr", "cruise_l_p_d"] }
```
```json
{ "n_runs": 260, "n_failed": 6, "n_constraint": 31, "elapsed_s": 16.4, "r": 20, "seed": 0,
  "inputs": [{"key": "payload_kg", "label": "Payload", "unit": "kg", "group": "Mission", "lo": 350, "hi": 550}],
  "results": { "mtow_kg": [
      {"param": "batt_spec_energy_w_h_p_kg", "mu": -208.1, "mu_star": 210.4, "mu_star_conf": 22.7,
       "sigma": 61.9, "n_effects": 19, "n_failed": 1}
  ]},
  "stability": { "mtow_kg": {"top5": ["batt_spec_energy_w_h_p_kg", "cruise_s", "payload_kg", "lift_rotor_count", "rotor_diameter_m"], "agreement": 0.91} } }
```
Effects are in output units **per full range of the input**: x is normalised to [0, 1] over `bounds`, so μ\* = 210 kg means sweeping battery specific energy across its whole box moves MTOW by about 210 kg on average.

### Steps
1. **Factors.** Build the 12 factors from the catalogue: `bounds` (same `{param: [lo, hi]}` shape) or else the study box. `tilt_rotor_count` isn't a factor, because `apply_overrides()` already ties it to `lift_rotor_count`.
2. **Trajectories.** Add `SALib` (pinned) to `requirements.txt` and use only `SALib.sample.morris.sample(problem, N=r, num_levels=levels, seed=seed)`. Don't use `SALib.analyze.morris`: it needs every run to succeed. Integer factors: round the scaled value; a step that rounds to no change yields no effect.
3. **Don't repair constraints.** C1–C6 repair would move more than one input per step and break the one-at-a-time structure. Size the designs as they are (C1–C6 are warnings, not errors), and report how many points violate a constraint in `n_constraint`.
4. **Run.** Send all r × (k + 1) configs through one `runner.map(size_summary, …)` call. Cap at `MAX_SCREENING_RUNS = 600` in `config.py` (r ≤ 46) and return 422 above it.
5. **Effects from the trajectory matrix.** For each consecutive pair of points in a trajectory, find the one input that changed, then compute `ee = (y_b − y_a) / (x_b − x_a)` in normalised units for each output. **If either point failed, drop only that effect**, not the whole trajectory, and count it in `n_failed` for that input.
6. **Statistics** per input and output:
   - `mu` = mean(ee), `mu_star` = mean(|ee|), `sigma` = std(ee, ddof=1), `n_effects`.
   - `mu_star_conf` = half-width of a 95% bootstrap interval of mean(|ee|), from 1,000 resamples (as SALib does it).
7. **Ranking stability, at no extra solver cost.** Bootstrap over whole trajectories (200 resamples) and report how often the top-5 set by μ\* equals the reported top 5, as `agreement`.
8. **Cache** the response in `RunStore` under `sha256(request)`, because the same seed and bounds always give the same answer.
9. Add `ScreeningRequest` to `schemas.py`, `EVTOL_SCREENING` to `paths.py` and `endpoints.js`, and document the route in `docs/api.md`.

### Tests
- `services/screening.py` takes a `size_fn`, so the tests can use an analytic model:
  - With `y = 10·x1 + x2² + x3·x4` and x5 unused: μ\*(x5) = 0, σ(x1) ≈ 0, and σ(x3) and σ(x4) > 0.
  - With a fake solver that fails whenever x1 > 0.9: only the effects that touch those points are dropped, and every input still has effects.
- API test on Archer with r = 4: shape check, `n_runs == 52`, and a second identical call is served from cache.

### Done when
- r = 20 finishes in ≤ 30 s on 4 workers.
- All five outputs come back with confidence intervals and per-input failure counts.
- `agreement` is reported for each output.

---

## M2-2 · [Frontend] Screening tab: μ\*–σ scatter and μ\* bars

**Labels:** `frontend` `demo2` `plot-2`  ·  **Depends on:** M2-1 (start against a saved JSON response)

### What the user sees
- **Controls**: trajectories r (10 / 20 / 30), seed, and **Run screening** with an estimated time (`r × 13 / 16` s). The page shows a spinner while the request runs.
- **Output buttons**: MTOW · Empty mass · Battery mass · Total energy · Cruise L/D. Switching between them needs no new request.
- **Meta line**: `r = 20 trajectories · 260 runs · 6 failed · 16.4 s`. When `agreement < 0.8`, an amber "Ranking unstable, try a larger r" badge appears.
- **Left: μ\*–σ scatter.** One dot per input, coloured by parameter group (Mission / Geometry / Propulsion / Battery) and labelled for the top 6 by μ\*.
  - Three dashed rays from the origin at σ/μ\* = 0.1, 0.5 and 1.0. Below 0.1 the input is near-linear; above 1.0 it is strongly nonlinear or interacting.
  - A grey box near the origin (μ\* < 12% of the largest) labelled "freeze / coarse step".
  - Tooltip: μ\* ± CI, σ, σ/μ\*, valid effects and failed runs.
- **Right: μ\* bars**, sorted descending, with 95% CI whiskers. A red "N failed" note appears when an input lost ≥ 25% of its effects.
- **Reading guide** under the charts, one line each:
  - Near the origin: fix the input or give it a coarse slider step.
  - High μ\*, low σ: a linear driver, so a uniform step suits it.
  - High σ: use a finer step and map it against its partner in the closure map (Plot 4).

### Steps
1. `index.html`: add a **Screening** tab and `<section id="view-screening">`.
2. New `demo2/scripts/screeningView.js`, built on the helpers in `charts.js` (`chartFrame`, `styleAxis`, `gridY`, `createTooltip`, `onResize`) and the bar styling of `sensitivityView.js` / Demo 1's tornado.
3. Scales: linear x and y from 0, padded 10%. The rays are clipped to the plot area. Each bar's whisker spans μ\* ± conf, clamped at 0.
4. Group colours come from one map shared with the parallel coordinates (P3-2), so an input has the same colour in both views.
5. A visually hidden `<table>` (`.sr-only`) gives the same numbers for screen readers.
6. Optional, after it works: an "Order inputs by importance" toggle that sorts the slider rows inside each group by μ\* (MTOW) and badges the top 3. `form.js` needs `reorder(keys)` for this.

### Done when
- r = 20 renders both charts for all five outputs, with failure counts and the unstable flag where it applies.
- The top-5 inputs for MTOW match across seeds 0 and 1, or the badge says the ranking is unstable.
- Hover, resize and dark mode all work.

---

## P3-1 · [Backend] Ensemble v2: serve precomputed ensembles, bounds and `append_to`

**Labels:** `backend` `demo2` `plot-3`  ·  **Depends on:** nothing (also feeds Plot 5's surrogate)

### Already on the branch
Sizing 2,000 designs takes about 60 s on a 14-core laptop (13 workers), and longer on the 2-worker container. That is too long to wait every time the demo starts, so ensembles are precomputed offline and mounted into the backend container:

- `pipelines/lhs.py`: `lhs_repair(n, seed, lows=None, highs=None)` samples any sub-box and keeps the C1–C6 repair.
- `app/services/ensemble.py`: `sample_inputs()`, `build_payload()` and `ensemble_id = sha256(baseline, n_samples, seed, bounds)[:16]`. They are shared by `POST /ensemble` and the script, so a precomputed collection and one sized on request have the same rows and the same id.
- `pipelines/precompute_ensemble.py` writes `output/prebuilt/ensembles/<id>.json` (the `/ensemble` response plus `n_samples`, `created`, `elapsed_s`) and an `index.json` listing every collection. `output/` is git-ignored, so **each teammate regenerates the files locally**:
  ```bash
  cd backend
  python -m pipelines.precompute_ensemble             # 2,000 Archer designs, seed 0
  python -m pipelines.precompute_ensemble --n 2000 --seed 0 --baseline Joby_s4 --bounds box.json
  ```
- `deploy/docker-compose.yml` mounts `backend/output/prebuilt` read-only at `/srv/prebuilt` and sets `PREBUILT_DIR=/srv/prebuilt`.

### Tasks
- [ ] `config.py`: `prebuilt_dir: Path | None` from `PREBUILT_DIR`. At startup, read `index.json` if it exists. A missing directory is not an error; the demo just has no ready-made ensembles.
- [ ] `GET /api/v1/evtol/ensembles` returns the index (both the prebuilt collections and those made at runtime). `GET /api/v1/evtol/ensembles/{id}` returns one collection.
  - Look up `RUNS_DIR/ensembles/<id>.json` first, then `PREBUILT_DIR`, because the prebuilt directory is read-only.
  - Add both routes to `paths.py` and `endpoints.js`.
- [ ] `POST /ensemble` saves its result to `RUNS_DIR/ensembles/<id>.json`. An identical request returns the stored file without sizing anything.
- [ ] Add `bounds: {param: [lo, hi]} | None` to `EnsembleRequest`. It defaults to the study box, must lie inside `[limit_min, limit_max]` (422 otherwise), and is passed to `sample_inputs()`.
- [ ] `append_to=<id>`:
  - Load the collection (from runs or prebuilt) and sample `n_samples` new designs inside `bounds` with seed `hash(id, current_count)`.
  - Continue the `run` numbering and give each new row a `batch` number (0 for the original, then 1, 2, …).
  - Save the merged collection to `RUNS_DIR` under the same id (copy-on-write over the prebuilt file), and return only the new rows plus `n_total`.
- [ ] Add `status_class()` (see conventions) and apply it **when a collection is loaded**, so files precomputed earlier stay valid.
- [ ] Keep `MAX_ENSEMBLE_SAMPLES = 200` for synchronous requests. Anything larger goes through the script.
- [ ] Rancher (M8): a PVC named `prebuilt` mounted read-only at `/srv/prebuilt`, filled once by a Kubernetes Job that runs `python -m pipelines.precompute_ensemble --out /srv/prebuilt` from the same backend image. Add it to `deploy/k8s/base` and document it in `backend/README.md`.
- [ ] Tests:
  - With a temporary `PREBUILT_DIR` holding a 5-row collection, `GET /ensembles` lists it and `GET /ensembles/{id}` returns it.
  - `append_to` adds exactly `n` rows inside the bounds and leaves the prebuilt file untouched.
  - Bounds outside the slider limits return 422.
  - An identical `POST /ensemble` doesn't size anything the second time.

### Done when
- `docker compose up` with a precomputed 2,000-design collection lets the Ensemble tab show it within 1 s of the page loading, with no sizing at boot.
- "50 more inside these bounds" returns in ≤ 5 s.
- A page refresh reloads the same collection, appended rows included.

---

## P3-2 · [Frontend] Reusable parallel coordinates with axis brushing

**Labels:** `frontend` `demo2` `plot-3`  ·  **Depends on:** P3-1 (can start now on a file from `pipelines/precompute_ensemble.py`)

### Why reuse Demo 1
`frontend/demo1/scripts/parallelCoordinates.js` already draws thousands of lines on canvas, with hover and pin highlights. But it hard-codes the GTB777 dimensions, the feasibility labels and the title, and it has no axis brushing.

### Tasks
- [ ] Move it to `frontend/shared/plots/parallelCoordinates.js` and take a config: `{ dimensions: [{key, label, unit, type: "number"|"category"}], colorBy: (row) => color, drawOrder, title, subtitle }`. Demo 1 passes its current values. Check that Demo 1 still renders as before.
- [ ] Demo 2 axes, in order:
  - the 12 inputs, in catalogue group order;
  - a visual gap;
  - the 5 outputs (MTOW, empty mass, battery mass, energy, L/D);
  - a categorical `status` axis.
- [ ] **Failed designs stay visible**: their outputs are `null`, so draw them into a "no value" band under each output axis, in grey, below the coloured lines. Never filter them out silently.
- [ ] **Brushing**:
  - One `d3.brushY` per axis; brushes on several axes combine with AND.
  - Store them in data units as `filters = {key: [lo, hi]}`, the same bounds shape as the API.
  - On every brush event, recompute `selectedIds` (O(N·k), trivial at N = 2,000) and call `onFilter(filters, selectedIds)`.
  - Double-click an axis to clear its brush; add a "Clear brushes" button.
- [ ] Draw selected lines in their `colorBy` colour at full opacity and unselected lines grey at alpha ≈ 0.08. At N ≤ 2,000, a full canvas redraw per brush event is fast enough, so keep the worker path only for Demo 1.
- [ ] A **Colour by** dropdown: status (default), cruise L/D, MTOW.
- [ ] Public API: `setRows(rows)`, `setFilters(filters)` (so the scatter can drive it), `highlight(id)`, `destroy()`.

### Done when
- Brushing any axis updates the selection at 60 fps on 2,000 rows.
- Failed designs are visible in grey.
- Demo 1's parallel plot looks and behaves as it did before.

---

## P3-3 · [Frontend] Linked Pareto scatter, "sample more here" and CSV export

**Labels:** `frontend` `demo2` `plot-3`  ·  **Depends on:** P3-1, P3-2

### Tasks
- [ ] **Pure Pareto module** `frontend/shared/pareto.js`, with `node --test` unit tests (CI already runs these on pure modules):
  - `paretoFront(rows, [{key: "mtow_kg", sense: "min"}, {key: "total_energy_kw_hr", sense: "min"}])`.
  - For 2 objectives: sort by the first objective, sweep with a running best of the second, O(n log n).
  - For 3 objectives (adding `cruise_l_p_d`, `sense: "max"`): plain O(n²) dominance check, which is fine at 2,000 rows.
  - Only `converged` rows take part.
- [ ] **Scatter** (replaces today's `ensembleView.js` chart):
  - x = MTOW, y = total energy, colour = cruise L/D on a sequential scale with a legend.
  - The front is **recomputed on the brushed subset** and drawn as a `d3.curveStepAfter` line, with front points outlined.
  - Dominated points inside the brush draw at reduced opacity; points outside the brush draw very faint.
  - A badge reads "N failed — grey in parallel coordinates" so failures are never silently dropped.
  - Toggle "include L/D as an objective" (3-D front, drawn as outlined points without a step line).
- [ ] **Linking**: one small state object in `ensembleView.js`, `{rows, filters, selectedIds, hoverId}`.
  - A brush in the parallel coordinates updates the scatter.
  - A 2-D `d3.brush` on the scatter writes `mtow_kg` and `total_energy_kw_hr` into the same `filters`, so they show up as axis brushes in the parallel coordinates.
  - Hover highlights the design in both views; click keeps the existing `onPickDesign` (loads the design into the form).
- [ ] **"Sample 50 more here"**:
  - Turn the brushes on **input** axes into `bounds`; output brushes can't be sampled directly, so they only filter the result afterwards.
  - Clamp the bounds to `[limit_min, limit_max]`, then POST `{append_to, bounds, n_samples: 50}`.
  - Merge the new rows and pulse them (via `batch`) for 2 s.
  - Disable the button with a tooltip when no input axis is brushed.
- [ ] **Download brushed CSV**: reuse `downloadCsv()` with the selected rows plus a `pareto` column (true/false).
- [ ] Layout: parallel coordinates full width on top, scatter below with a summary row: `selected 312 / 2,000 · front 14 · failed in selection 41`.

### Done when
- Brushing any axis updates the scatter and its front with no server call at N = 2,000.
- Failed designs stay visible.
- "Sample more here" appends ≥ 50 designs inside the brush in ≤ 5 s.
- The brushed subset downloads as CSV.
- The `pareto.js` tests cover ties, a single point, all-dominated input and mixed min/max senses.
