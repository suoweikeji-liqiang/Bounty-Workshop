from __future__ import annotations

import os
import subprocess
from functools import lru_cache
from pathlib import Path
import tomllib


ROOT_DIR = Path(__file__).resolve().parents[1]
PYPROJECT_PATH = ROOT_DIR / "pyproject.toml"


def _read_pyproject_version() -> str | None:
    try:
        raw = PYPROJECT_PATH.read_text(encoding="utf-8")
        data = tomllib.loads(raw)
        version = str(data.get("project", {}).get("version", "")).strip()
        return version or None
    except Exception:
        return None


@lru_cache(maxsize=1)
def get_backend_version() -> str:
    env_version = os.getenv("APP_VERSION", "").strip()
    if env_version:
        return env_version
    return _read_pyproject_version() or "unknown"


@lru_cache(maxsize=1)
def get_backend_git_sha() -> str:
    env_sha = os.getenv("APP_BUILD_SHA", "").strip()
    if env_sha:
        return env_sha
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=ROOT_DIR,
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
        return out or "unknown"
    except Exception:
        return "unknown"
