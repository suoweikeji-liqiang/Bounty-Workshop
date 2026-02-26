from __future__ import annotations

import argparse
import os
import sqlite3
from pathlib import Path


DB_PATH = Path(os.getenv("APP_DB_PATH", "data/app.db"))


def _count(cur: sqlite3.Cursor, table: str) -> int:
    cur.execute(f"SELECT COUNT(1) FROM {table}")
    row = cur.fetchone()
    return int(row[0]) if row else 0


def _print_snapshot(cur: sqlite3.Cursor) -> None:
    tables = [
        "problem",
        "task",
        "claim",
        "claimapprovalrequest",
        "claimmember",
        "deliverable",
        "acceptance",
        "reward",
        "knowledge",
        "problemanalysis",
        "hypothesisverification",
        "problemreviewanalysisref",
    ]
    print("Current rows:")
    for table in tables:
        print(f"  - {table}: {_count(cur, table)}")


def _delete_problem_history(cur: sqlite3.Cursor) -> None:
    cur.execute("DELETE FROM acceptance")
    cur.execute("DELETE FROM claimmember")
    cur.execute("DELETE FROM deliverable")
    cur.execute("DELETE FROM claimapprovalrequest")
    cur.execute("DELETE FROM claim")
    cur.execute("DELETE FROM reward")
    cur.execute("DELETE FROM knowledge")
    cur.execute("DELETE FROM hypothesisverification")
    cur.execute("DELETE FROM problemreviewanalysisref")
    cur.execute("DELETE FROM problemanalysis")
    cur.execute("DELETE FROM task")
    cur.execute("DELETE FROM problem")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Clear historical problem/task workflow data from SQLite database."
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Execute deletion. Without this flag, it only prints current counts (dry run).",
    )
    args = parser.parse_args()

    if not DB_PATH.exists():
        print(f"Database not found: {DB_PATH}")
        return 1

    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.cursor()
        _print_snapshot(cur)

        if not args.yes:
            print("\nDry run only. Re-run with --yes to actually delete historical problem data.")
            return 0

        _delete_problem_history(cur)
        con.commit()
        print("\nDeletion completed.")
        _print_snapshot(cur)
        return 0
    finally:
        con.close()


if __name__ == "__main__":
    raise SystemExit(main())
