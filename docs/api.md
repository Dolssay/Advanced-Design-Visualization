# API reference (v1)

Every path is declared in `backend/app/api/paths.py` and named identically in
`frontend/shared/api/endpoints.js`. The live, generated docs are at `/api/docs`.

Shape: `/api/<version>/<domain>/<resource>[/<id>[/<sub-resource>]]`

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/healthz` | – | `{"status":"ok"}`, liveness (not versioned, for Kubernetes) |
| GET | `/readyz` | – | 200 after warm-up sizing, else 503 |
| GET | `/api/v1/info` | – | version, git SHA, evtolpy SHA, readiness, baselines, route list |
| GET | `/api/v1/evtol/baselines` | – | `{baselines:[{name,label,design}]}`: design = catalogue values |
| GET | `/api/v1/evtol/baselines/{name}` | – | full baseline JSON |
| GET | `/api/v1/evtol/parameters` | – | catalogue: parameters (min, max, step, unit, group), constraints, outputs, image kinds, limits |
| POST | `/api/v1/evtol/size` | `{baseline, overrides}` | `{run_id, design, warnings, result, images[], cached}` |
| GET | `/api/v1/evtol/runs/{run_id}` | – | the cached `/size` response |
| GET | `/api/v1/evtol/runs/{run_id}/images/{kind}.png` | – | PNG; kind = `layout`, `mass-breakdown`, `power-profile`, `energy-profile`, `cruise-drag-buildup` |
| POST | `/api/v1/evtol/sweep` | `{baseline, overrides, parameter, start?, stop?, step?}` | `{parameter, design, points:[{value,status,mtow_kg,...,warnings}]}` |
| POST | `/api/v1/evtol/sensitivity` | `{baseline, overrides, delta_pct=10, parameters?}` | `{base, rows:[{key,low_value,high_value,low,high}]}` |
| POST | `/api/v1/evtol/ensemble` | `{baseline, n_samples=50, seed=0}` | `{status_counts, rows:[{run, inputs..., outputs...}]}` |
| POST | `/api/v1/evtol/feasibility` | `{baseline, overrides, parameters?, priority=[], resolution=13, refine=3}` | NDJSON stream: one `{param, limit, current, constraint, segments, feasible, points}` line per parameter, then `{done, n_runs, elapsed_s, cached}` |

## Example

```http
POST /api/v1/evtol/size
Content-Type: application/json

{"baseline": "Archer_Midnight", "overrides": {"payload_kg": 480, "batt_spec_energy_w_h_p_kg": 270}}
```

`overrides` keys come from `/api/v1/evtol/parameters`. Only send the values you
change; everything else stays at the baseline. Setting `lift_rotor_count` also sets
`tilt_rotor_count` (equal) and `rotor_count` (their sum).

## Feasibility slices (NDJSON)

`POST /api/v1/evtol/feasibility` answers, for each parameter, "with every other
input held at the current design, which values close?". The response is
`application/x-ndjson`: one JSON object per line, flushed as soon as it is ready
(`priority` parameters first), so read it with a streaming body reader.

```json
{"param":"batt_spec_energy_w_h_p_kg","limit":[65,510],"current":256,"constraint":[],
 "segments":[{"lo":65,"hi":204.1,"status":"diverged","reason":"MTOW iteration diverged at iteration 4: ..."},
             {"lo":204.1,"hi":222.6,"status":"max_iter","reason":"MTOW did not converge in 60 iterations ..."},
             {"lo":222.6,"hi":510,"status":"converged"}],
 "feasible":[[222.6,510]],
 "points":[{"value":65,"status":"diverged","mtow_kg":null,"iterations":null}]}
{"done":true,"n_runs":132,"elapsed_s":6.1,"cached":0}
```

- `limit` is the slider range: `limit_min`/`limit_max` from `/parameters`, widened to include the baseline's value.
- `constraint` lists the C1-C6 bounds on this parameter (`{id, lo, hi, text}`); values outside them are
  marked `constraint` without sizing. If they leave no allowed value the whole slice is one `constraint` segment.
- Segment `status` is `constraint`, `converged`, `max_iter` (no convergence in `FEASIBILITY_MAX_ITER` = 60 iterations),
  `diverged` or `error`. `reason` is the solver's message for failed segments.
- Each slice is cached under the baseline and the other 11 values (a slice does not depend on its own
  parameter's value), so dragging one slider only recomputes the other slices. Cached lines come first and
  `cached` counts them. Closing the connection cancels the remaining rounds.
- `resolution` grid points are sized across the allowed range (integers use every value), then every status change
  is bisected `refine` times. A timeout after the stream has started arrives as an `{"error": {code, message}}` line.

## Errors

Errors are `{"detail": {"code": ..., "message": ...}}`.

| Status | code | When |
| --- | --- | --- |
| 404 | `unknown_baseline`, `unknown_run`, `unknown_image` | Name or id not found |
| 422 | `invalid_overrides` | Unknown key, outside the slider range (`limit_min`-`limit_max`, widened to the baseline's value), or non-integer rotor count (`errors[]` lists each) |
| 422 | `sizing_failed` | evtolpy could not size the design (`status` is usually `ValueError`: MTOW diverged) |
| 422 | `too_many_points`, `too_many_samples` | Sweep or ensemble above the limit in `/parameters` |
| 422 | `unknown_parameter` | `/sweep`, `/sensitivity` or `/feasibility` names a parameter not in the catalogue |
| 504 | `sizing_timeout` | A design took longer than `SIZING_TIMEOUT_S` |

`warnings` in a `/size` response lists layout constraints (C1–C6) the design breaks.
They don't block sizing, because some reference aircraft sit outside them.
