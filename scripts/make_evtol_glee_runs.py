"""Size an LHS ensemble of eVTOL designs and zip it for Image GLEE.

    python make_evtol_glee_runs.py                      # 200 Archer designs, seed 0
    python make_evtol_glee_runs.py --n 50 --seed 1
    python make_evtol_glee_runs.py --baseline data/baselines/Joby_s4.json
    python make_evtol_glee_runs.py --workers 1          # least RAM, slowest (default 2)

Run it with backend/.venv active, from any folder. Extra arguments go to
backend/pipelines/ensemble.py (--baseline is relative to backend/). Writes
output/GLEEinputs/evtol_runs/ensemble_data/ and, next to it, evtol_feasible.zip
(converged runs) and evtol_all_runs.zip (every run, Status 1/0).
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "output" / "GLEEinputs" / "evtol_runs"
DATA = OUT / "ensemble_data"


def main():
    for old in DATA.glob("*.png"):  # pictures from an earlier, larger run would linger otherwise
        old.unlink()
    # One BLAS thread per worker: otherwise each of the N workers starts N OpenBLAS threads and
    # runs out of memory. 2 workers by default; a --workers you pass comes later and wins.
    env = {**os.environ, "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1"}
    subprocess.run([sys.executable, "-m", "pipelines.ensemble", "--out", str(OUT), "--workers", "2", *sys.argv[1:]],
                   cwd=REPO / "backend", env=env, check=True)

    shutil.copy2(REPO / "tools" / "demo1-prep" / "make_glee_zip.py", DATA)
    for extra in ([], ["--keep-failed"]):
        subprocess.run([sys.executable, str(DATA / "make_glee_zip.py"), "--folder", str(DATA),
                        "--status-pass", "Success", "--aircraft", "evtol", *extra], check=True)


if __name__ == "__main__":
    main()
