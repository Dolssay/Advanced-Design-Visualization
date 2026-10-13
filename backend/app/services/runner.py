"""Runs sizing in a pool of worker processes.

Processes rather than threads because matplotlib's pyplot keeps global state and
because a slow design must not block the event loop. The pool uses the "spawn"
start method so behaviour is the same on Windows (dev laptops) and Linux (pods).
"""

from __future__ import annotations

import asyncio
import multiprocessing as mp
from concurrent.futures import ProcessPoolExecutor
from typing import Any, Callable


def _init_worker() -> None:
    import matplotlib

    matplotlib.use("Agg")


class SizingTimeout(RuntimeError):
    pass


class SizingRunner:
    def __init__(self, workers: int, timeout_s: int):
        self.workers = max(1, workers)
        self.timeout_s = timeout_s
        self._pool: ProcessPoolExecutor | None = None

    def start(self) -> None:
        if self._pool is None:
            self._pool = ProcessPoolExecutor(
                max_workers=self.workers,
                mp_context=mp.get_context("spawn"),
                initializer=_init_worker,
            )

    def shutdown(self) -> None:
        if self._pool is not None:
            self._pool.shutdown(wait=False, cancel_futures=True)
            self._pool = None

    async def run(self, fn: Callable[..., Any], *args: Any) -> Any:
        self.start()
        loop = asyncio.get_running_loop()
        future = loop.run_in_executor(self._pool, fn, *args)
        try:
            return await asyncio.wait_for(future, timeout=self.timeout_s)
        except asyncio.TimeoutError as exc:
            raise SizingTimeout(f"Sizing took longer than {self.timeout_s} s.") from exc

    async def map(self, fn: Callable[..., Any], items: list[Any]) -> list[Any]:
        """Run ``fn(item)`` for every item in parallel; order is preserved.

        The timeout applies to the whole batch, scaled by how many rounds the
        pool needs."""
        self.start()
        loop = asyncio.get_running_loop()
        futures = [loop.run_in_executor(self._pool, fn, item) for item in items]
        rounds = -(-len(items) // self.workers) if items else 1
        try:
            return await asyncio.wait_for(asyncio.gather(*futures), timeout=self.timeout_s * rounds)
        except asyncio.TimeoutError as exc:
            for f in futures:
                f.cancel()
            raise SizingTimeout(f"Batch of {len(items)} designs timed out.") from exc
