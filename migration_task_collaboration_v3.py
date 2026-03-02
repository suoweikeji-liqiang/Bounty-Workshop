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


def _ensure_task_is_complex(cur: sqlite3.Cursor) -> int:
    if not _table_exists(cur, "task"):
        print("[SKIP] table task not found")
        return 0

    changes = 0
    if not _column_exists(cur, "task", "is_complex"):
        cur.execute("ALTER TABLE task ADD COLUMN is_complex INTEGER NOT NULL DEFAULT 0")
        print("[ADD] task.is_complex")
        changes += 1
    else:
        print("[SKIP] task.is_complex already exists")

    if not _index_exists(cur, "ix_task_is_complex"):
        cur.execute("CREATE INDEX ix_task_is_complex ON task(is_complex)")
        print("[ADD] index ix_task_is_complex")
        changes += 1
    else:
        print("[SKIP] index ix_task_is_complex already exists")

    if not _column_exists(cur, "task", "closing_reward_ratio"):
        cur.execute("ALTER TABLE task ADD COLUMN closing_reward_ratio REAL NOT NULL DEFAULT 1.0")
        print("[ADD] task.closing_reward_ratio")
        changes += 1
    else:
        print("[SKIP] task.closing_reward_ratio already exists")

    return changes


def _ensure_problem_priced_is_complex(cur: sqlite3.Cursor) -> int:
    if not _table_exists(cur, "problem"):
        print("[SKIP] table problem not found")
        return 0
    changes = 0
    if not _column_exists(cur, "problem", "priced_is_complex"):
        cur.execute("ALTER TABLE problem ADD COLUMN priced_is_complex INTEGER NOT NULL DEFAULT 0")
        print("[ADD] problem.priced_is_complex")
        changes += 1
    else:
        print("[SKIP] problem.priced_is_complex already exists")

    if not _column_exists(cur, "problem", "priced_closing_reward_ratio"):
        cur.execute("ALTER TABLE problem ADD COLUMN priced_closing_reward_ratio REAL NOT NULL DEFAULT 1.0")
        print("[ADD] problem.priced_closing_reward_ratio")
        changes += 1
    else:
        print("[SKIP] problem.priced_closing_reward_ratio already exists")

    if not _column_exists(cur, "problem", "priced_milestones_json"):
        cur.execute("ALTER TABLE problem ADD COLUMN priced_milestones_json TEXT NOT NULL DEFAULT '[]'")
        print("[ADD] problem.priced_milestones_json")
        changes += 1
    else:
        print("[SKIP] problem.priced_milestones_json already exists")
    return changes


def _ensure_task_activity_table(cur: sqlite3.Cursor) -> int:
    changes = 0
    if not _table_exists(cur, "taskactivity"):
        cur.execute(
            """
            CREATE TABLE taskactivity (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                claim_id INTEGER,
                activity_type TEXT NOT NULL,
                actor_user_id INTEGER NOT NULL,
                content TEXT NOT NULL,
                detail_json TEXT NOT NULL DEFAULT '{}',
                attachment_urls TEXT NOT NULL DEFAULT '[]',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(task_id) REFERENCES task(id),
                FOREIGN KEY(claim_id) REFERENCES claim(id),
                FOREIGN KEY(actor_user_id) REFERENCES user(id)
            )
            """
        )
        print("[ADD] table taskactivity")
        changes += 1
    else:
        print("[SKIP] table taskactivity already exists")

    for column_name, ddl in {
        "detail_json": "TEXT NOT NULL DEFAULT '{}'",
        "attachment_urls": "TEXT NOT NULL DEFAULT '[]'",
    }.items():
        if _column_exists(cur, "taskactivity", column_name):
            print(f"[SKIP] taskactivity.{column_name} already exists")
            continue
        cur.execute(f"ALTER TABLE taskactivity ADD COLUMN {column_name} {ddl}")
        print(f"[ADD] taskactivity.{column_name}")
        changes += 1

    for index_name, sql in {
        "ix_taskactivity_task_id": "CREATE INDEX ix_taskactivity_task_id ON taskactivity(task_id)",
        "ix_taskactivity_claim_id": "CREATE INDEX ix_taskactivity_claim_id ON taskactivity(claim_id)",
        "ix_taskactivity_activity_type": "CREATE INDEX ix_taskactivity_activity_type ON taskactivity(activity_type)",
        "ix_taskactivity_actor_user_id": "CREATE INDEX ix_taskactivity_actor_user_id ON taskactivity(actor_user_id)",
        "ix_taskactivity_created_at": "CREATE INDEX ix_taskactivity_created_at ON taskactivity(created_at)",
    }.items():
        if _index_exists(cur, index_name):
            print(f"[SKIP] index {index_name} already exists")
            continue
        cur.execute(sql)
        print(f"[ADD] index {index_name}")
        changes += 1

    return changes


def _ensure_milestone_tables(cur: sqlite3.Cursor) -> int:
    changes = 0
    if not _table_exists(cur, "taskmilestone"):
        cur.execute(
            """
            CREATE TABLE taskmilestone (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                sequence INTEGER NOT NULL,
                title TEXT NOT NULL,
                goal TEXT NOT NULL,
                due_date DATE,
                acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
                reward_ratio REAL NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(task_id) REFERENCES task(id)
            )
            """
        )
        print("[ADD] table taskmilestone")
        changes += 1
    else:
        print("[SKIP] table taskmilestone already exists")

    if not _table_exists(cur, "milestonesubmission"):
        cur.execute(
            """
            CREATE TABLE milestonesubmission (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                milestone_id INTEGER NOT NULL,
                claim_id INTEGER NOT NULL,
                summary TEXT NOT NULL,
                evidence_urls TEXT NOT NULL DEFAULT '[]',
                criteria_results_json TEXT NOT NULL DEFAULT '[]',
                submitted_by_user_id INTEGER NOT NULL,
                submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(milestone_id) REFERENCES taskmilestone(id),
                FOREIGN KEY(claim_id) REFERENCES claim(id),
                FOREIGN KEY(submitted_by_user_id) REFERENCES user(id)
            )
            """
        )
        print("[ADD] table milestonesubmission")
        changes += 1
    else:
        print("[SKIP] table milestonesubmission already exists")

    if not _table_exists(cur, "milestoneacceptance"):
        cur.execute(
            """
            CREATE TABLE milestoneacceptance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                milestone_id INTEGER NOT NULL,
                submission_id INTEGER NOT NULL,
                accepter_id INTEGER NOT NULL,
                result TEXT NOT NULL,
                comment TEXT,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(milestone_id) REFERENCES taskmilestone(id),
                FOREIGN KEY(submission_id) REFERENCES milestonesubmission(id),
                FOREIGN KEY(accepter_id) REFERENCES user(id)
            )
            """
        )
        print("[ADD] table milestoneacceptance")
        changes += 1
    else:
        print("[SKIP] table milestoneacceptance already exists")

    if not _table_exists(cur, "milestonerewardhold"):
        cur.execute(
            """
            CREATE TABLE milestonerewardhold (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                milestone_id INTEGER NOT NULL,
                claim_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                ratio REAL NOT NULL,
                amount REAL NOT NULL,
                status TEXT NOT NULL DEFAULT 'earned',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                released_at DATETIME,
                FOREIGN KEY(task_id) REFERENCES task(id),
                FOREIGN KEY(milestone_id) REFERENCES taskmilestone(id),
                FOREIGN KEY(claim_id) REFERENCES claim(id),
                FOREIGN KEY(user_id) REFERENCES user(id)
            )
            """
        )
        print("[ADD] table milestonerewardhold")
        changes += 1
    else:
        print("[SKIP] table milestonerewardhold already exists")

    for index_name, sql in {
        "ix_taskmilestone_task_id": "CREATE INDEX ix_taskmilestone_task_id ON taskmilestone(task_id)",
        "ix_taskmilestone_sequence": "CREATE INDEX ix_taskmilestone_sequence ON taskmilestone(sequence)",
        "ix_taskmilestone_status": "CREATE INDEX ix_taskmilestone_status ON taskmilestone(status)",
        "ix_milestonesubmission_milestone_id": "CREATE INDEX ix_milestonesubmission_milestone_id ON milestonesubmission(milestone_id)",
        "ix_milestonesubmission_claim_id": "CREATE INDEX ix_milestonesubmission_claim_id ON milestonesubmission(claim_id)",
        "ix_milestonesubmission_submitted_by_user_id": "CREATE INDEX ix_milestonesubmission_submitted_by_user_id ON milestonesubmission(submitted_by_user_id)",
        "ix_milestoneacceptance_milestone_id": "CREATE INDEX ix_milestoneacceptance_milestone_id ON milestoneacceptance(milestone_id)",
        "ix_milestoneacceptance_submission_id": "CREATE INDEX ix_milestoneacceptance_submission_id ON milestoneacceptance(submission_id)",
        "ix_milestoneacceptance_accepter_id": "CREATE INDEX ix_milestoneacceptance_accepter_id ON milestoneacceptance(accepter_id)",
        "ix_milestonerewardhold_task_id": "CREATE INDEX ix_milestonerewardhold_task_id ON milestonerewardhold(task_id)",
        "ix_milestonerewardhold_milestone_id": "CREATE INDEX ix_milestonerewardhold_milestone_id ON milestonerewardhold(milestone_id)",
        "ix_milestonerewardhold_claim_id": "CREATE INDEX ix_milestonerewardhold_claim_id ON milestonerewardhold(claim_id)",
        "ix_milestonerewardhold_user_id": "CREATE INDEX ix_milestonerewardhold_user_id ON milestonerewardhold(user_id)",
        "ix_milestonerewardhold_status": "CREATE INDEX ix_milestonerewardhold_status ON milestonerewardhold(status)",
    }.items():
        if _index_exists(cur, index_name):
            print(f"[SKIP] index {index_name} already exists")
            continue
        cur.execute(sql)
        print(f"[ADD] index {index_name}")
        changes += 1
    return changes


def main() -> int:
    if not DB_PATH.exists():
        print(f"Database not found: {DB_PATH}")
        return 1

    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        changes = 0
        changes += _ensure_task_is_complex(cur)
        changes += _ensure_problem_priced_is_complex(cur)
        changes += _ensure_task_activity_table(cur)
        changes += _ensure_milestone_tables(cur)
        con.commit()
        if changes == 0:
            print("No migration needed.")
        else:
            print(f"Migration completed with {changes} change(s).")
        return 0
    finally:
        con.close()


if __name__ == "__main__":
    raise SystemExit(main())
