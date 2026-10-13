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

## Example

```http
POST /api/v1/evtol/size
Content-Type: application/json

{"baseline": "Archer_Midnight", "overrides": {"payload_kg": 480, "batt_spec_energy_w_h_p_kg": 270}}
```

`overrides` keys come from `/api/v1/evtol/parameters`. Only send the values you
change; everything else stays at the baseline. Setting `lift_rotor_count` also sets
`tilt_rotor_count` (equal) and `rotor_count` (their sum).

## Errors

Errors are `{"detail": {"code": ..., "message": ...}}`.

| Status | code | When |
| --- | --- | --- |
| 404 | `unknown_baseline`, `unknown_run`, `unknown_image` | Name or id not found |
| 422 | `invalid_overrides` | Unknown key, out of catalogue range, or non-integer rotor count (`errors[]` lists each) |
| 422 | `sizing_failed` | evtolpy could not size the design (`status` is usually `ValueError`: MTOW diverged) |
| 422 | `too_many_points`, `too_many_samples` | Sweep or ensemble above the limit in `/parameters` |
| 504 | `sizing_timeout` | A design took longer than `SIZING_TIMEOUT_S` |

`warnings` in a `/size` response lists layout constraints (C1–C6) the design breaks.
They don't block sizing, because some reference aircraft sit outside them.
