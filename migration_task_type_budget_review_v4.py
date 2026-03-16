from __future__ import annotations

import os
import sqlite3
from pathlib import Path


DB_PATH = Path(os.getenv("APP_DB_PATH", "data/app.db"))


def _table_exists(cur: sqlite3.Cursor, table_name: str) -> bool:
    row = cur.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
        (table_name,),
    ).fetchone()
    return row is not None


def _column_exists(cur: sqlite3.Cursor, table_name: str, column_name: str) -> bool:
    rows = cur.execute(f"PRAGMA table_info({table_name})").fetchall()
    return any(row[1] == column_name for row in rows)


def _index_exists(cur: sqlite3.Cursor, index_name: str) -> bool:
    row = cur.execute(
        "SELECT 1 FROM sqlite_master WHERE type='index' AND name=? LIMIT 1",
        (index_name,),
    ).fetchone()
    return row is not None


def _ensure_problem_priced_task_type(cur: sqlite3.Cursor) -> int:
    if not _table_exists(cur, "problem"):
        print("[SKIP] table problem not found")
        return 0

    changes = 0
    if not _column_exists(cur, "problem", "priced_task_type"):
        cur.execute("ALTER TABLE problem ADD COLUMN priced_task_type TEXT NOT NULL DEFAULT 'normal'")
        if _column_exists(cur, "problem", "priced_is_complex"):
            cur.execute(
                "UPDATE problem SET priced_task_type = CASE WHEN priced_is_complex = 1 THEN 'complex' ELSE 'normal' END"
            )
        print("[ADD] problem.priced_task_type")
        changes += 1
    else:
        print("[SKIP] problem.priced_task_type already exists")
    return changes


def _ensure_task_task_type(cur: sqlite3.Cursor) -> int:
    if not _table_exists(cur, "task"):
        print("[SKIP] table task not found")
        return 0

    changes = 0
    if not _column_exists(cur, "task", "task_type"):
        cur.execute("ALTER TABLE task ADD COLUMN task_type TEXT NOT NULL DEFAULT 'normal'")
        if _column_exists(cur, "task", "is_complex"):
            cur.execute("UPDATE task SET task_type = CASE WHEN is_complex = 1 THEN 'complex' ELSE 'normal' END")
        print("[ADD] task.task_type")
        changes += 1
    else:
        print("[SKIP] task.task_type already exists")

    if not _index_exists(cur, "ix_task_task_type"):
        cur.execute("CREATE INDEX ix_task_task_type ON task(task_type)")
        print("[ADD] index ix_task_task_type")
        changes += 1
    else:
        print("[SKIP] index ix_task_task_type already exists")
    return changes


def main() -> int:
    if not DB_PATH.exists():
        print(f"Database not found: {DB_PATH}")
        return 1

    with sqlite3.connect(DB_PATH) as con:
        cur = con.cursor()
        changes = 0
        changes += _ensure_problem_priced_task_type(cur)
        changes += _ensure_task_task_type(cur)
        con.commit()
        if changes == 0:
            print("No migration needed.")
        else:
            print(f"Migration completed: {changes} change(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
