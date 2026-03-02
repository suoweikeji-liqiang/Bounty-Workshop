from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime

from sqlmodel import Session

from app.feishu import (
    DEFAULT_SYNC_FREQUENCY_MINUTES,
    get_feishu_provider,
    get_sync_frequency_minutes,
    run_feishu_sync,
)
from app.models import SystemConfig
from app.services import release_overdue_claims
from app.services_common import (
    DEFAULT_STALE_PROGRESS_REMINDER_COOLDOWN_HOURS,
    DEFAULT_STALE_PROGRESS_THRESHOLD_DAYS,
    MIN_STALE_PROGRESS_REMINDER_COOLDOWN_HOURS,
    MIN_STALE_PROGRESS_THRESHOLD_DAYS,
    STALE_PROGRESS_REMINDER_COOLDOWN_HOURS_KEY,
    STALE_PROGRESS_THRESHOLD_DAYS_KEY,
)
from app.services_task_activity import emit_stale_progress_reminders


logger = logging.getLogger(__name__)

RELEASE_OVERDUE_FREQUENCY_KEY = "release_overdue_frequency_minutes"
DEFAULT_RELEASE_OVERDUE_FREQUENCY_MINUTES = 1440
MIN_RELEASE_OVERDUE_FREQUENCY_MINUTES = 5
STALE_PROGRESS_REMINDER_FREQUENCY_KEY = "stale_progress_reminder_frequency_minutes"
DEFAULT_STALE_PROGRESS_REMINDER_FREQUENCY_MINUTES = 720
MIN_STALE_PROGRESS_REMINDER_FREQUENCY_MINUTES = 5


def _parse_bool(raw: str | None, default: bool) -> bool:
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def is_background_jobs_enabled() -> bool:
    return _parse_bool(os.getenv("ENABLE_BACKGROUND_JOBS"), default=True)


def is_feishu_sync_job_enabled() -> bool:
    return _parse_bool(os.getenv("ENABLE_FEISHU_SYNC_JOB"), default=True)


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


def get_stale_progress_reminder_frequency_minutes(session: Session) -> int:
    row = session.get(SystemConfig, STALE_PROGRESS_REMINDER_FREQUENCY_KEY)
    if row is None:
        value = DEFAULT_STALE_PROGRESS_REMINDER_FREQUENCY_MINUTES
        session.add(SystemConfig(key=STALE_PROGRESS_REMINDER_FREQUENCY_KEY, value=str(value)))
        session.commit()
        return value
    try:
        value = int(row.value)
    except ValueError:
        value = DEFAULT_STALE_PROGRESS_REMINDER_FREQUENCY_MINUTES
    return max(value, MIN_STALE_PROGRESS_REMINDER_FREQUENCY_MINUTES)


def set_stale_progress_reminder_frequency_minutes(session: Session, frequency_minutes: int) -> int:
    value = max(frequency_minutes, MIN_STALE_PROGRESS_REMINDER_FREQUENCY_MINUTES)
    row = session.get(SystemConfig, STALE_PROGRESS_REMINDER_FREQUENCY_KEY)
    now = datetime.utcnow()
    if row is None:
        session.add(SystemConfig(key=STALE_PROGRESS_REMINDER_FREQUENCY_KEY, value=str(value), updated_at=now))
    else:
        row.value = str(value)
        row.updated_at = now
    session.commit()
    return value


def get_stale_progress_threshold_days(session: Session) -> int:
    row = session.get(SystemConfig, STALE_PROGRESS_THRESHOLD_DAYS_KEY)
    if row is None:
        value = DEFAULT_STALE_PROGRESS_THRESHOLD_DAYS
        session.add(SystemConfig(key=STALE_PROGRESS_THRESHOLD_DAYS_KEY, value=str(value)))
        session.commit()
        return value
    try:
        value = int(row.value)
    except ValueError:
        value = DEFAULT_STALE_PROGRESS_THRESHOLD_DAYS
    return max(value, MIN_STALE_PROGRESS_THRESHOLD_DAYS)


def set_stale_progress_threshold_days(session: Session, threshold_days: int) -> int:
    value = max(threshold_days, MIN_STALE_PROGRESS_THRESHOLD_DAYS)
    row = session.get(SystemConfig, STALE_PROGRESS_THRESHOLD_DAYS_KEY)
    now = datetime.utcnow()
    if row is None:
        session.add(SystemConfig(key=STALE_PROGRESS_THRESHOLD_DAYS_KEY, value=str(value), updated_at=now))
    else:
        row.value = str(value)
        row.updated_at = now
    session.commit()
    return value


def get_stale_progress_reminder_cooldown_hours(session: Session) -> int:
    row = session.get(SystemConfig, STALE_PROGRESS_REMINDER_COOLDOWN_HOURS_KEY)
    if row is None:
        value = DEFAULT_STALE_PROGRESS_REMINDER_COOLDOWN_HOURS
        session.add(SystemConfig(key=STALE_PROGRESS_REMINDER_COOLDOWN_HOURS_KEY, value=str(value)))
        session.commit()
        return value
    try:
        value = int(row.value)
    except ValueError:
        value = DEFAULT_STALE_PROGRESS_REMINDER_COOLDOWN_HOURS
    return max(value, MIN_STALE_PROGRESS_REMINDER_COOLDOWN_HOURS)


def set_stale_progress_reminder_cooldown_hours(session: Session, cooldown_hours: int) -> int:
    value = max(cooldown_hours, MIN_STALE_PROGRESS_REMINDER_COOLDOWN_HOURS)
    row = session.get(SystemConfig, STALE_PROGRESS_REMINDER_COOLDOWN_HOURS_KEY)
    now = datetime.utcnow()
    if row is None:
        session.add(SystemConfig(key=STALE_PROGRESS_REMINDER_COOLDOWN_HOURS_KEY, value=str(value), updated_at=now))
    else:
        row.value = str(value)
        row.updated_at = now
    session.commit()
    return value


def run_stale_progress_reminders(
    session: Session,
    actor_id: int | None = None,
    now: datetime | None = None,
) -> dict:
    threshold_days = get_stale_progress_threshold_days(session)
    cooldown_hours = get_stale_progress_reminder_cooldown_hours(session)
    return emit_stale_progress_reminders(
        session=session,
        actor_user_id=actor_id,
        now=now,
        stale_days=threshold_days,
        cooldown_hours=cooldown_hours,
    )


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


async def run_stale_progress_reminder_scheduler(session_factory, stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        interval_minutes = DEFAULT_STALE_PROGRESS_REMINDER_FREQUENCY_MINUTES
        try:
            with session_factory() as session:
                interval_minutes = get_stale_progress_reminder_frequency_minutes(session)
                result = run_stale_progress_reminders(session, actor_id=None)
            logger.info(
                "stale_progress_reminder job done, reminders_created=%s, checked_claims=%s, next_run_in_minutes=%s",
                result["reminders_created"],
                result["checked_claims"],
                interval_minutes,
            )
        except Exception:
            logger.exception("stale_progress_reminder job failed")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=max(interval_minutes, 1) * 60)
        except TimeoutError:
            continue


async def run_feishu_sync_scheduler(session_factory, stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        interval_minutes = DEFAULT_SYNC_FREQUENCY_MINUTES
        try:
            provider = get_feishu_provider()
            with session_factory() as session:
                interval_minutes = get_sync_frequency_minutes(session)
                result = run_feishu_sync(session, provider=provider, mode="all")
            logger.info(
                "feishu sync job done, synced_departments=%s, synced_users=%s, next_run_in_minutes=%s",
                result.synced_departments,
                result.synced_users,
                interval_minutes,
            )
        except Exception:
            logger.exception("feishu sync job failed")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=max(interval_minutes, 1) * 60)
        except TimeoutError:
            continue
