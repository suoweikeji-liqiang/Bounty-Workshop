from __future__ import annotations

import importlib
import os
import sqlite3
from pathlib import Path

from sqlmodel import Session, select

from app.models import Deliverable, Problem, Task


def _create_legacy_schema(db_file: Path) -> None:
    con = sqlite3.connect(db_file)
    try:
        cur = con.cursor()
        cur.executescript(
            """
            CREATE TABLE user (
                id INTEGER PRIMARY KEY,
                name VARCHAR NOT NULL,
                status VARCHAR(8) NOT NULL,
                overdue_count INTEGER NOT NULL,
                created_at DATETIME NOT NULL
            );

            CREATE TABLE problem (
                id INTEGER PRIMARY KEY,
                title VARCHAR(50) NOT NULL,
                scenario VARCHAR(8) NOT NULL,
                background VARCHAR NOT NULL,
                frequency VARCHAR(10) NOT NULL,
                impact_scope VARCHAR NOT NULL,
                description VARCHAR NOT NULL,
                value_reduce_effort BOOLEAN NOT NULL,
                value_reduce_cost BOOLEAN NOT NULL,
                value_improve_quality BOOLEAN NOT NULL,
                value_statement VARCHAR NOT NULL,
                current_solution VARCHAR,
                attachment_urls VARCHAR NOT NULL,
                submitter_id INTEGER NOT NULL,
                status VARCHAR(14) NOT NULL,
                reject_reason VARCHAR,
                merged_problem_id INTEGER,
                created_at DATETIME NOT NULL,
                analysis_id INTEGER,
                analysis_status VARCHAR DEFAULT 'PENDING',
                draft_goal TEXT,
                draft_scope TEXT,
                draft_due_date DATE,
                draft_acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
                submitter_reflection TEXT,
                reviewer_comment TEXT,
                priced_level TEXT,
                priced_reward_total REAL,
                priced_proposer_ratio REAL,
                priced_accepter_id INTEGER,
                priced_points INTEGER NOT NULL DEFAULT 0,
                priced_badge TEXT,
                priced_by_user_id INTEGER,
                budget_review_comment TEXT,
                budget_reviewed_by_user_id INTEGER,
                budget_reviewed_at DATETIME
            );

            CREATE TABLE task (
                id INTEGER PRIMARY KEY,
                problem_id INTEGER NOT NULL,
                title VARCHAR NOT NULL,
                goal VARCHAR NOT NULL,
                scope VARCHAR NOT NULL,
                due_date DATE NOT NULL,
                level VARCHAR(1) NOT NULL,
                reward_total FLOAT NOT NULL,
                proposer_ratio FLOAT NOT NULL,
                accepter_id INTEGER NOT NULL,
                points INTEGER NOT NULL,
                badge VARCHAR,
                acceptance_criteria_json VARCHAR NOT NULL,
                status VARCHAR(18) NOT NULL,
                created_at DATETIME NOT NULL
            );

            CREATE TABLE deliverable (
                id INTEGER PRIMARY KEY,
                claim_id INTEGER NOT NULL UNIQUE,
                summary VARCHAR NOT NULL,
                evidence_urls VARCHAR NOT NULL,
                criteria_results_json VARCHAR NOT NULL,
                status VARCHAR(12) NOT NULL,
                submitted_at DATETIME NOT NULL
            );
            """
        )
        cur.execute(
            """
            INSERT INTO user (id, name, status, overdue_count, created_at)
            VALUES (1, 'tester', 'ENABLED', 0, '2026-03-16 00:00:00')
            """
        )
        cur.execute(
            """
            INSERT INTO problem (
                id, title, scenario, background, frequency, impact_scope, description,
                value_reduce_effort, value_reduce_cost, value_improve_quality, value_statement,
                current_solution, attachment_urls, submitter_id, status, created_at,
                analysis_status, draft_acceptance_criteria_json, priced_points
            )
            VALUES (
                1, 'legacy problem', 'RD', 'bg', 'DAILY', 'team', 'desc',
                1, 0, 0, 'value', NULL, '[]', 1, 'DRAFT', '2026-03-16 00:00:00',
                'PENDING', '[]', 0
            )
            """
        )
        cur.execute(
            """
            INSERT INTO task (
                id, problem_id, title, goal, scope, due_date, level, reward_total,
                proposer_ratio, accepter_id, points, badge, acceptance_criteria_json,
                status, created_at
            )
            VALUES (
                1, 1, 'legacy task', 'goal', 'scope', '2026-03-20', 'A', 1000,
                0.2, 1, 100, NULL, '[]', 'OPEN', '2026-03-16 00:00:00'
            )
            """
        )
        cur.execute(
            """
            INSERT INTO deliverable (
                id, claim_id, summary, evidence_urls, criteria_results_json, status, submitted_at
            )
            VALUES (1, 1, 'legacy deliverable', '[]', '[]', 'SUBMITTED', '2026-03-16 00:00:00')
            """
        )
        con.commit()
    finally:
        con.close()


def test_init_db_migrates_legacy_columns_for_problem_and_task(tmp_path: Path, monkeypatch) -> None:
    db_file = tmp_path / "legacy.db"
    _create_legacy_schema(db_file)

    import app.db as db_module

    original_path = os.environ.get("APP_DB_PATH")
    try:
        monkeypatch.setenv("APP_DB_PATH", str(db_file))
        db_module = importlib.reload(db_module)

        db_module.init_db()

        with sqlite3.connect(db_file) as con:
            problem_columns = {row[1] for row in con.execute("PRAGMA table_info(problem)").fetchall()}
            task_columns = {row[1] for row in con.execute("PRAGMA table_info(task)").fetchall()}
            deliverable_columns = {row[1] for row in con.execute("PRAGMA table_info(deliverable)").fetchall()}
            raw_problem_task_type = con.execute("SELECT priced_task_type FROM problem WHERE id = 1").fetchone()[0]
            raw_task_type = con.execute("SELECT task_type FROM task WHERE id = 1").fetchone()[0]

        assert "priced_is_complex" in problem_columns
        assert "priced_closing_reward_ratio" in problem_columns
        assert "priced_milestones_json" in problem_columns
        assert "task_type" in task_columns
        assert "is_complex" in task_columns
        assert "closing_reward_ratio" in task_columns
        assert "rework_count" in deliverable_columns
        assert raw_problem_task_type == "NORMAL"
        assert raw_task_type == "NORMAL"

        with Session(db_module.engine) as session:
            problem = session.exec(select(Problem)).one()
            task = session.exec(select(Task)).one()
            deliverable = session.exec(select(Deliverable)).one()

        assert problem.priced_is_complex is False
        assert problem.priced_closing_reward_ratio == 1.0
        assert problem.priced_milestones_json == "[]"
        assert problem.priced_task_type.value == "normal"
        assert task.is_complex is False
        assert task.closing_reward_ratio == 1.0
        assert task.task_type.value == "normal"
        assert deliverable.rework_count == 0
    finally:
        if original_path is None:
            monkeypatch.delenv("APP_DB_PATH", raising=False)
        else:
            monkeypatch.setenv("APP_DB_PATH", original_path)
        importlib.reload(db_module)
