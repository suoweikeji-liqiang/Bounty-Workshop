from collections.abc import Generator
import os
from pathlib import Path
import sqlite3

from sqlalchemy import event as sa_event
from sqlmodel import Session, SQLModel, create_engine


DB_PATH = Path(os.getenv("APP_DB_PATH", "data/app.db"))
DATABASE_URL = f"sqlite:///{DB_PATH}"
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False, "timeout": 30},
)


@sa_event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=30000")
    cursor.close()


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    SQLModel.metadata.create_all(engine)
    _migrate_additive_columns()


def _column_exists(cur: sqlite3.Cursor, table_name: str, column_name: str) -> bool:
    rows = cur.execute(f"PRAGMA table_info({table_name})").fetchall()
    return any(row[1] == column_name for row in rows)


def _index_exists(cur: sqlite3.Cursor, index_name: str) -> bool:
    row = cur.execute(
        "SELECT 1 FROM sqlite_master WHERE type='index' AND name=? LIMIT 1",
        (index_name,),
    ).fetchone()
    return row is not None


def _migrate_additive_columns() -> None:
    if not DB_PATH.exists():
        return
    with sqlite3.connect(DB_PATH) as con:
        cur = con.cursor()
        changed = False
        if _column_exists(cur, "problem", "id") and not _column_exists(cur, "problem", "priced_is_complex"):
            cur.execute("ALTER TABLE problem ADD COLUMN priced_is_complex BOOLEAN NOT NULL DEFAULT 0")
            changed = True
        if _column_exists(cur, "problem", "id") and not _column_exists(cur, "problem", "priced_closing_reward_ratio"):
            cur.execute("ALTER TABLE problem ADD COLUMN priced_closing_reward_ratio REAL NOT NULL DEFAULT 1.0")
            changed = True
        if _column_exists(cur, "problem", "id") and not _column_exists(cur, "problem", "priced_milestones_json"):
            cur.execute("ALTER TABLE problem ADD COLUMN priced_milestones_json TEXT NOT NULL DEFAULT '[]'")
            changed = True
        if _column_exists(cur, "problem", "id") and not _column_exists(cur, "problem", "priced_task_type"):
            cur.execute("ALTER TABLE problem ADD COLUMN priced_task_type TEXT NOT NULL DEFAULT 'NORMAL'")
            if _column_exists(cur, "problem", "priced_is_complex"):
                cur.execute(
                    "UPDATE problem SET priced_task_type = CASE WHEN priced_is_complex = 1 THEN 'COMPLEX' ELSE 'NORMAL' END"
                )
            changed = True
        if _column_exists(cur, "problem", "priced_task_type"):
            cur.execute(
                """
                UPDATE problem
                SET priced_task_type = CASE LOWER(priced_task_type)
                    WHEN 'normal' THEN 'NORMAL'
                    WHEN 'complex' THEN 'COMPLEX'
                    WHEN 'mountain' THEN 'MOUNTAIN'
                    ELSE priced_task_type
                END
                WHERE LOWER(priced_task_type) IN ('normal', 'complex', 'mountain')
                """
            )
            changed = True
        if _column_exists(cur, "task", "id") and not _column_exists(cur, "task", "is_complex"):
            cur.execute("ALTER TABLE task ADD COLUMN is_complex BOOLEAN NOT NULL DEFAULT 0")
            changed = True
        if _column_exists(cur, "task", "id") and not _column_exists(cur, "task", "closing_reward_ratio"):
            cur.execute("ALTER TABLE task ADD COLUMN closing_reward_ratio REAL NOT NULL DEFAULT 1.0")
            changed = True
        if _column_exists(cur, "task", "id") and not _column_exists(cur, "task", "task_type"):
            cur.execute("ALTER TABLE task ADD COLUMN task_type TEXT NOT NULL DEFAULT 'NORMAL'")
            if _column_exists(cur, "task", "is_complex"):
                cur.execute("UPDATE task SET task_type = CASE WHEN is_complex = 1 THEN 'COMPLEX' ELSE 'NORMAL' END")
            changed = True
        if _column_exists(cur, "task", "task_type"):
            cur.execute(
                """
                UPDATE task
                SET task_type = CASE LOWER(task_type)
                    WHEN 'normal' THEN 'NORMAL'
                    WHEN 'complex' THEN 'COMPLEX'
                    WHEN 'mountain' THEN 'MOUNTAIN'
                    ELSE task_type
                END
                WHERE LOWER(task_type) IN ('normal', 'complex', 'mountain')
                """
            )
            changed = True
        if _column_exists(cur, "deliverable", "id") and not _column_exists(cur, "deliverable", "rework_count"):
            cur.execute("ALTER TABLE deliverable ADD COLUMN rework_count INTEGER NOT NULL DEFAULT 0")
            changed = True
        if _column_exists(cur, "task", "task_type") and not _index_exists(cur, "ix_task_task_type"):
            cur.execute("CREATE INDEX ix_task_task_type ON task(task_type)")
            changed = True
        if _column_exists(cur, "task", "is_complex") and not _index_exists(cur, "ix_task_is_complex"):
            cur.execute("CREATE INDEX ix_task_is_complex ON task(is_complex)")
            changed = True
        if changed:
            con.commit()


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session
