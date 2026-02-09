from __future__ import annotations

import os
import threading
import time
from collections import deque
from dataclasses import dataclass
from typing import Deque

from fastapi import Header, HTTPException, Request


def _parse_bool(raw: str | None, default: bool = True) -> bool:
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _parse_int(raw: str | None, default: int) -> int:
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _client_key(
    request: Request,
    authorization: str | None,
    x_user_id: str | None,
) -> str:
    if authorization and authorization.strip():
        return f"token:{authorization.strip()[:64]}"
    if x_user_id and x_user_id.strip():
        return f"user:{x_user_id.strip()}"
    host = request.client.host if request.client else "unknown"
    return f"ip:{host}"


@dataclass
class _Bucket:
    timestamps: Deque[float]


class _RateLimitStore:
    def __init__(self) -> None:
        self._data: dict[str, _Bucket] = {}
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window_seconds: int) -> int:
        now = time.time()
        cutoff = now - window_seconds
        with self._lock:
            bucket = self._data.get(key)
            if bucket is None:
                bucket = _Bucket(timestamps=deque())
                self._data[key] = bucket
            while bucket.timestamps and bucket.timestamps[0] <= cutoff:
                bucket.timestamps.popleft()
            if len(bucket.timestamps) >= limit:
                wait_seconds = max(int(bucket.timestamps[0] + window_seconds - now), 1)
                return wait_seconds
            bucket.timestamps.append(now)
        return 0


_store = _RateLimitStore()


def rate_limit(
    bucket: str,
    limit: int,
    window_seconds: int,
):
    async def _checker(
        request: Request,
        authorization: str | None = Header(default=None),
        x_user_id: str | None = Header(default=None),
    ) -> None:
        if not _parse_bool(os.getenv("RATE_LIMIT_ENABLED"), default=True):
            return
        env_prefix = f"RATE_LIMIT_{bucket.upper()}"
        effective_limit = max(_parse_int(os.getenv(f"{env_prefix}_LIMIT"), limit), 1)
        effective_window = max(_parse_int(os.getenv(f"{env_prefix}_WINDOW_SECONDS"), window_seconds), 1)
        key = _client_key(request, authorization=authorization, x_user_id=x_user_id)
        wait_seconds = _store.hit(
            f"{bucket}:{key}",
            limit=effective_limit,
            window_seconds=effective_window,
        )
        if wait_seconds <= 0:
            return
        raise HTTPException(
            status_code=429,
            detail=f"too many requests for {bucket}, retry after {wait_seconds}s",
            headers={"Retry-After": str(wait_seconds)},
        )

    return _checker
