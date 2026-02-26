from __future__ import annotations

import os
import sqlite3
from pathlib import Path


DB_PATH = Path(os.getenv("APP_DB_PATH", "data/app.db"))

# Ensure the Problem table has all columns required by the submitter-led workflow.
PROBLEM_COLUMNS: dict[str, str] = {
    "draft_goal": "TEXT",
    "draft_scope": "TEXT",
    "draft_due_date": "DATE",
    "draft_acceptance_criteria_json": "TEXT NOT NULL DEFAULT '[]'",
    "submitter_reflection": "TEXT",
    "reviewer_comment": "TEXT",
    "priced_level": "TEXT",
    "priced_reward_total": "REAL",
    "priced_proposer_ratio": "REAL",
    "priced_accepter_id": "INTEGER",
    "priced_points": "INTEGER NOT NULL DEFAULT 0",
    "priced_badge": "TEXT",
    "priced_by_user_id": "INTEGER",
    "budget_review_comment": "TEXT",
    "budget_reviewed_by_user_id": "INTEGER",
    "budget_reviewed_at": "DATETIME",
    "analysis_id": "INTEGER",
    "analysis_status": "TEXT NOT NULL DEFAULT 'pending'",
}


def main() -> int:
    if not DB_PATH.exists():
        print(f"Database not found: {DB_PATH}")
        return 1

    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        cur.execute("PRAGMA table_info(problem)")
        existing = {row[1] for row in cur.fetchall()}
        if not existing:
            print("Table 'problem' not found. Please start backend once to initialize tables.")
            return 1

        added = 0
        for col, ddl in PROBLEM_COLUMNS.items():
            if col in existing:
                continue
            sql = f"ALTER TABLE problem ADD COLUMN {col} {ddl}"
            cur.execute(sql)
            print(f"[ADD] problem.{col}")
            added += 1

        con.commit()
        if added == 0:
            print("No migration needed: all workflow v2 columns already exist.")
        else:
            print(f"Migration completed: {added} column(s) added.")
        return 0
    finally:
        con.close()


if __name__ == "__main__":
    raise SystemExit(main())
