from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine

from app.db import get_session
from app.enums import Role
from app.main import app
from app.models import User, UserRole


def _headers(user_id: int) -> dict[str, str]:
    return {"X-User-Id": str(user_id)}


def _setup_client(tmp_path: Path) -> TestClient:
    db_file = tmp_path / "test_v2.db"
    engine = create_engine(f"sqlite:///{db_file}", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        admin = User(id=1, name="Admin", employee_no="A001", department="PMO")
        session.add(admin)
        for role in [Role.ADMIN, Role.REVIEWER, Role.ACCEPTOR, Role.EMPLOYEE, Role.REWARD_APPROVER]:
            session.add(UserRole(user_id=1, role=role))
        session.commit()

    def override_session():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    return TestClient(app)


def _create_problem_with_submitter_task(client: TestClient, employee_id: int) -> int:
    resp = client.post(
        "/problems",
        headers=_headers(employee_id),
        json={
            "title": "batch release process needs optimization",
            "scenario": "rd",
            "background": "manual release still takes too many repetitive steps",
            "frequency": "weekly",
            "impact_scope": "team",
            "description": "release quality fluctuates and takes long",
            "value_reduce_effort": True,
            "value_reduce_cost": False,
            "value_improve_quality": True,
            "value_statement": "reduce release effort and improve release quality",
            "task_draft": {
                "goal": "automate release checklist and core scripts",
                "scope": "build script + CI integration",
                "due_date": (date.today() + timedelta(days=7)).isoformat(),
                "acceptance_criteria": [
                    {"description": "script runs for 7 days", "type": "quantified"},
                    {"description": "release steps reduced to <= 2", "type": "behavioral"},
                ],
                "self_reflection": "main value is reducing repeated manual work",
            },
        },
    )
    assert resp.status_code == 200
    return resp.json()["id"]


def test_high_reward_requires_budget_review(tmp_path: Path) -> None:
    client = _setup_client(tmp_path)

    reviewer_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "Reviewer", "employee_no": "R002", "department": "QA", "roles": ["reviewer", "acceptor", "employee"]},
    )
    assert reviewer_resp.status_code == 200
    reviewer_id = reviewer_resp.json()["id"]

    reward_approver_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "Fin", "employee_no": "F001", "department": "Finance", "roles": ["reward_approver"]},
    )
    assert reward_approver_resp.status_code == 200
    reward_approver_id = reward_approver_resp.json()["id"]

    employee_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "Alice", "employee_no": "E002", "department": "RD", "roles": ["employee"]},
    )
    assert employee_resp.status_code == 200
    employee_id = employee_resp.json()["id"]

    problem_id = _create_problem_with_submitter_task(client, employee_id)

    submit_resp = client.post(
        f"/problems/{problem_id}/submit-for-review",
        headers=_headers(employee_id),
    )
    assert submit_resp.status_code == 200
    assert submit_resp.json()["status"] == "pending_review"

    review_resp = client.post(
        f"/problems/{problem_id}/review",
        headers=_headers(reviewer_id),
        json={
            "approve": True,
            "analysis_acceptance": "submitter has clear value statement",
            "pricing": {
                "level": "A",
                "reward_total": 5000,
                "proposer_ratio": 0.25,
                "accepter_id": reviewer_id,
                "points": 50,
                "badge": "impact-maker",
            },
        },
    )
    assert review_resp.status_code == 200
    assert review_resp.json()["status"] == "budget_pending"

    budget_approve_resp = client.post(
        f"/problems/{problem_id}/budget-review",
        headers=_headers(reward_approver_id),
        json={"approve": True, "comment": "budget approved"},
    )
    assert budget_approve_resp.status_code == 200
    assert budget_approve_resp.json()["status"] == "approved"
    assert budget_approve_resp.json()["task"]["id"] > 0

    app.dependency_overrides.clear()


def test_budget_review_preserves_task_is_complex(tmp_path: Path) -> None:
    client = _setup_client(tmp_path)

    reviewer_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "BudgetReviewer", "employee_no": "R020", "department": "QA", "roles": ["reviewer", "acceptor", "employee"]},
    )
    assert reviewer_resp.status_code == 200
    reviewer_id = reviewer_resp.json()["id"]

    reward_approver_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "BudgetApprover", "employee_no": "F020", "department": "Finance", "roles": ["reward_approver"]},
    )
    assert reward_approver_resp.status_code == 200
    reward_approver_id = reward_approver_resp.json()["id"]

    submitter_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "BudgetSubmitter", "employee_no": "E020", "department": "RD", "roles": ["employee"]},
    )
    assert submitter_resp.status_code == 200
    submitter_id = submitter_resp.json()["id"]

    problem_id = _create_problem_with_submitter_task(client, submitter_id)

    submit_resp = client.post(f"/problems/{problem_id}/submit-for-review", headers=_headers(submitter_id))
    assert submit_resp.status_code == 200
    assert submit_resp.json()["status"] == "pending_review"

    review_resp = client.post(
        f"/problems/{problem_id}/review",
        headers=_headers(reviewer_id),
        json={
            "approve": True,
            "task": {
                "title": "budget-complex-task",
                "goal": "persist complexity across budget review",
                "scope": "single workflow",
                "due_date": (date.today() + timedelta(days=7)).isoformat(),
                "level": "A",
                "reward_total": 5000,
                "proposer_ratio": 0.25,
                "accepter_id": reviewer_id,
                "points": 50,
                "badge": "impact-maker",
                "is_complex": True,
                "acceptance_criteria": [{"description": "complexity flag is preserved", "type": "quantified"}],
            },
        },
    )
    assert review_resp.status_code == 200
    assert review_resp.json()["status"] == "budget_pending"

    budget_approve_resp = client.post(
        f"/problems/{problem_id}/budget-review",
        headers=_headers(reward_approver_id),
        json={"approve": True, "comment": "budget approved"},
    )
    assert budget_approve_resp.status_code == 200
    budget_payload = budget_approve_resp.json()
    assert budget_payload["status"] == "approved"
    assert budget_payload["task"]["is_complex"] is True
    task_id = budget_payload["task"]["id"]

    task_detail_resp = client.get(f"/tasks/{task_id}", headers=_headers(submitter_id))
    assert task_detail_resp.status_code == 200
    assert task_detail_resp.json()["is_complex"] is True

    task_list_resp = client.get("/tasks", headers=_headers(submitter_id), params={"status": "open"})
    assert task_list_resp.status_code == 200
    task_row = next(item for item in task_list_resp.json() if item["id"] == task_id)
    assert task_row["is_complex"] is True

    app.dependency_overrides.clear()


def test_re_review_pricing_only_preserves_complexity_flag(tmp_path: Path) -> None:
    client = _setup_client(tmp_path)

    reviewer_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "ReReviewReviewer", "employee_no": "R021", "department": "QA", "roles": ["reviewer", "acceptor", "employee"]},
    )
    assert reviewer_resp.status_code == 200
    reviewer_id = reviewer_resp.json()["id"]

    reward_approver_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "ReReviewFin", "employee_no": "F021", "department": "Finance", "roles": ["reward_approver"]},
    )
    assert reward_approver_resp.status_code == 200
    reward_approver_id = reward_approver_resp.json()["id"]

    submitter_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "ReReviewSubmitter", "employee_no": "E021", "department": "RD", "roles": ["employee"]},
    )
    assert submitter_resp.status_code == 200
    submitter_id = submitter_resp.json()["id"]

    problem_id = _create_problem_with_submitter_task(client, submitter_id)

    submit_resp = client.post(f"/problems/{problem_id}/submit-for-review", headers=_headers(submitter_id))
    assert submit_resp.status_code == 200

    first_review_resp = client.post(
        f"/problems/{problem_id}/review",
        headers=_headers(reviewer_id),
        json={
            "approve": True,
            "task": {
                "title": "re-review-complex-task",
                "goal": "keep complexity across re-review",
                "scope": "single workflow",
                "due_date": (date.today() + timedelta(days=7)).isoformat(),
                "level": "A",
                "reward_total": 5000,
                "proposer_ratio": 0.25,
                "accepter_id": reviewer_id,
                "points": 50,
                "badge": "impact-maker",
                "is_complex": True,
                "acceptance_criteria": [{"description": "complexity survives", "type": "quantified"}],
            },
        },
    )
    assert first_review_resp.status_code == 200
    assert first_review_resp.json()["status"] == "budget_pending"

    budget_reject_resp = client.post(
        f"/problems/{problem_id}/budget-review",
        headers=_headers(reward_approver_id),
        json={"approve": False, "comment": "please lower reward"},
    )
    assert budget_reject_resp.status_code == 200
    assert budget_reject_resp.json()["status"] == "pricing_revision_required"

    second_review_resp = client.post(
        f"/problems/{problem_id}/review",
        headers=_headers(reviewer_id),
        json={
            "approve": True,
            "pricing": {
                "level": "C",
                "reward_total": 600,
                "proposer_ratio": 0.3,
                "accepter_id": reviewer_id,
                "points": 10,
                "badge": None,
            },
        },
    )
    assert second_review_resp.status_code == 200
    second_review_payload = second_review_resp.json()
    assert second_review_payload["status"] == "approved"
    assert second_review_payload["task"]["is_complex"] is True
    task_id = second_review_payload["task"]["id"]

    task_detail_resp = client.get(f"/tasks/{task_id}", headers=_headers(submitter_id))
    assert task_detail_resp.status_code == 200
    assert task_detail_resp.json()["is_complex"] is True

    app.dependency_overrides.clear()


def test_reviewer_prices_but_does_not_define_task_content(tmp_path: Path) -> None:
    client = _setup_client(tmp_path)

    reviewer_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "Reviewer", "employee_no": "R003", "department": "QA", "roles": ["reviewer", "acceptor", "employee"]},
    )
    assert reviewer_resp.status_code == 200
    reviewer_id = reviewer_resp.json()["id"]

    employee_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "Bob", "employee_no": "E003", "department": "RD", "roles": ["employee"]},
    )
    assert employee_resp.status_code == 200
    employee_id = employee_resp.json()["id"]

    problem_id = _create_problem_with_submitter_task(client, employee_id)

    submit_resp = client.post(
        f"/problems/{problem_id}/submit-for-review",
        headers=_headers(employee_id),
    )
    assert submit_resp.status_code == 200

    review_resp = client.post(
        f"/problems/{problem_id}/review",
        headers=_headers(reviewer_id),
        json={
            "approve": True,
            "pricing": {
                "level": "C",
                "reward_total": 600,
                "proposer_ratio": 0.3,
                "accepter_id": reviewer_id,
                "points": 10,
                "badge": None,
            },
        },
    )
    assert review_resp.status_code == 200
    task_id = review_resp.json()["task"]["id"]

    task_detail_resp = client.get(f"/tasks/{task_id}", headers=_headers(employee_id))
    assert task_detail_resp.status_code == 200
    payload = task_detail_resp.json()
    assert payload["goal"] == "automate release checklist and core scripts"
    assert payload["scope"] == "build script + CI integration"

    app.dependency_overrides.clear()


def test_submit_for_review_auto_triggers_analysis(tmp_path: Path, monkeypatch) -> None:
    client = _setup_client(tmp_path)

    employee_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "Carol", "employee_no": "E004", "department": "RD", "roles": ["employee"]},
    )
    assert employee_resp.status_code == 200
    employee_id = employee_resp.json()["id"]

    problem_id = _create_problem_with_submitter_task(client, employee_id)

    called_problem_ids: list[int] = []

    def fake_trigger(problem_id: int) -> None:
        called_problem_ids.append(problem_id)

    monkeypatch.setattr("app.routers.problems._trigger_analysis_background", fake_trigger)

    submit_resp = client.post(
        f"/problems/{problem_id}/submit-for-review",
        headers=_headers(employee_id),
    )
    assert submit_resp.status_code == 200
    assert submit_resp.json()["status"] == "pending_review"
    assert called_problem_ids == [problem_id]

    app.dependency_overrides.clear()
