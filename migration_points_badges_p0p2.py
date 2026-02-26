from __future__ import annotations

import os
import sqlite3
from pathlib import Path

DB_PATH = Path(os.getenv("APP_DB_PATH", "data/app.db"))
ACTIVE_CLAIM_INDEX = "uq_claim_task_lead_active"


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


def _add_deliverable_rework_count(cur: sqlite3.Cursor) -> int:
    if not _table_exists(cur, "deliverable"):
        print("[SKIP] table deliverable not found")
        return 0
    if _column_exists(cur, "deliverable", "rework_count"):
        print("[SKIP] deliverable.rework_count already exists")
        return 0
    cur.execute("ALTER TABLE deliverable ADD COLUMN rework_count INTEGER NOT NULL DEFAULT 0")
    print("[ADD] deliverable.rework_count")
    return 1


def _ensure_userbadge_table(cur: sqlite3.Cursor) -> int:
    if not _table_exists(cur, "userbadge"):
        cur.execute(
            """
            CREATE TABLE userbadge (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                badge_code TEXT NOT NULL,
                source_type TEXT NOT NULL,
                source_id INTEGER,
                earned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES user(id)
            )
            """
        )
        print("[ADD] table userbadge")
    else:
        print("[SKIP] table userbadge already exists")

    changes = 0
    if not _index_exists(cur, "uq_user_badge"):
        cur.execute("CREATE UNIQUE INDEX uq_user_badge ON userbadge(user_id, badge_code)")
        print("[ADD] index uq_user_badge")
        changes += 1
    else:
        print("[SKIP] index uq_user_badge already exists")

    if not _index_exists(cur, "ix_userbadge_user_id"):
        cur.execute("CREATE INDEX ix_userbadge_user_id ON userbadge(user_id)")
        print("[ADD] index ix_userbadge_user_id")
        changes += 1
    else:
        print("[SKIP] index ix_userbadge_user_id already exists")

    if not _index_exists(cur, "ix_userbadge_badge_code"):
        cur.execute("CREATE INDEX ix_userbadge_badge_code ON userbadge(badge_code)")
        print("[ADD] index ix_userbadge_badge_code")
        changes += 1
    else:
        print("[SKIP] index ix_userbadge_badge_code already exists")

    return changes + (1 if _table_exists(cur, "userbadge") else 0)


def _ensure_active_claim_unique_index(cur: sqlite3.Cursor) -> int:
    if not _table_exists(cur, "claim"):
        print("[SKIP] table claim not found")
        return 0
    if _index_exists(cur, ACTIVE_CLAIM_INDEX):
        print(f"[SKIP] index {ACTIVE_CLAIM_INDEX} already exists")
        return 0

    duplicates = cur.execute(
        """
        SELECT task_id, lead_user_id, COUNT(*)
        FROM claim
        WHERE status = 'active'
        GROUP BY task_id, lead_user_id
        HAVING COUNT(*) > 1
        """
    ).fetchall()
    if duplicates:
        print("[ERROR] duplicate active claims found. resolve these rows first:")
        for task_id, lead_user_id, count in duplicates:
            print(f"  - task_id={task_id}, lead_user_id={lead_user_id}, rows={count}")
        raise RuntimeError("cannot create active-claim unique index while duplicates exist")

    cur.execute(
        "CREATE UNIQUE INDEX uq_claim_task_lead_active ON claim(task_id, lead_user_id) WHERE status = 'active'"
    )
    print("[ADD] index uq_claim_task_lead_active")
    return 1


def main() -> int:
    if not DB_PATH.exists():
        print(f"Database not found: {DB_PATH}")
        return 1

    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        changes = 0
        changes += _add_deliverable_rework_count(cur)
        changes += _ensure_userbadge_table(cur)
        changes += _ensure_active_claim_unique_index(cur)
        con.commit()
        if changes == 0:
            print("No migration needed.")
        else:
            print(f"Migration completed with {changes} change(s).")
        return 0
    except RuntimeError as exc:
        con.rollback()
        print(str(exc))
        return 2
    finally:
        con.close()


if __name__ == "__main__":
    raise SystemExit(main())
