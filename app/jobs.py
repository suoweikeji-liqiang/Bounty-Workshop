from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime

from sqlmodel import Session

from app.models import SystemConfig
from app.services import release_overdue_claims


logger = logging.getLogger(__name__)

RELEASE_OVERDUE_FREQUENCY_KEY = "release_overdue_frequency_minutes"
DEFAULT_RELEASE_OVERDUE_FREQUENCY_MINUTES = 1440
MIN_RELEASE_OVERDUE_FREQUENCY_MINUTES = 5


def _parse_bool(raw: str | None, default: bool) -> bool:
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def is_background_jobs_enabled() -> bool:
    return _parse_bool(os.getenv("ENABLE_BACKGROUND_JOBS"), default=True)


def get_release_overdue_frequency_minutes(session: Session) -> int:
    row = session.get(SystemConfig, RELEASE_OVERDUE_FREQUENCY_KEY)
    if row is None:
        value = DEFAULT_RELEASE_OVERDUE_FREQUENCY_MINUTES
        session.add(SystemConfig(key=RELEASE_OVERDUE_FREQUENCY_KEY, value=str(value)))
        session.commit()
        return value
    try:
        value = int(row.value)
    except ValueError:
        value = DEFAULT_RELEASE_OVERDUE_FREQUENCY_MINUTES
    return max(value, MIN_RELEASE_OVERDUE_FREQUENCY_MINUTES)


def set_release_overdue_frequency_minutes(session: Session, frequency_minutes: int) -> int:
    value = max(frequency_minutes, MIN_RELEASE_OVERDUE_FREQUENCY_MINUTES)
    row = session.get(SystemConfig, RELEASE_OVERDUE_FREQUENCY_KEY)
    now = datetime.utcnow()
    if row is None:
        session.add(SystemConfig(key=RELEASE_OVERDUE_FREQUENCY_KEY, value=str(value), updated_at=now))
    else:
        row.value = str(value)
        row.updated_at = now
    session.commit()
    return value


async def run_release_overdue_scheduler(session_factory, stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        interval_minutes = DEFAULT_RELEASE_OVERDUE_FREQUENCY_MINUTES
        try:
            with session_factory() as session:
                interval_minutes = get_release_overdue_frequency_minutes(session)
                result = release_overdue_claims(session, actor_id=None)
            logger.info(
                "release_overdue job done, released_claims=%s, next_run_in_minutes=%s",
                result["released_claims"],
                interval_minutes,
            )
        except Exception:
            logger.exception("release_overdue job failed")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=max(interval_minutes, 1) * 60)
        except TimeoutError:
            continue

