from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine

from app.db import get_session
from app.enums import AnalysisStatus, HypothesisStatus, HypothesisType, RiskLevel, Role
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
                "closing_reward_ratio": 0.4,
                "milestones": [
                    {
                        "sequence": 1,
                        "title": "m1",
                        "goal": "first phase",
                        "reward_ratio": 0.3,
                        "acceptance_criteria": [{"description": "phase 1 done", "type": "quantified"}],
                    },
                    {
                        "sequence": 2,
                        "title": "m2",
                        "goal": "second phase",
                        "reward_ratio": 0.3,
                        "acceptance_criteria": [{"description": "phase 2 done", "type": "quantified"}],
                    },
                ],
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
                "closing_reward_ratio": 0.4,
                "milestones": [
                    {
                        "sequence": 1,
                        "title": "m1",
                        "goal": "first phase",
                        "reward_ratio": 0.3,
                        "acceptance_criteria": [{"description": "phase 1 done", "type": "quantified"}],
                    },
                    {
                        "sequence": 2,
                        "title": "m2",
                        "goal": "second phase",
                        "reward_ratio": 0.3,
                        "acceptance_criteria": [{"description": "phase 2 done", "type": "quantified"}],
                    },
                ],
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


def test_problem_and_task_transparency_with_mine_filter(tmp_path: Path) -> None:
    client = _setup_client(tmp_path)

    reviewer_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "TransparentReviewer", "employee_no": "R099", "department": "QA", "roles": ["reviewer", "acceptor", "employee"]},
    )
    assert reviewer_resp.status_code == 200
    reviewer_id = reviewer_resp.json()["id"]

    submitter_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "TransparentSubmitter", "employee_no": "E099", "department": "RD", "roles": ["employee"]},
    )
    assert submitter_resp.status_code == 200
    submitter_id = submitter_resp.json()["id"]

    viewer_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "TransparentViewer", "employee_no": "E100", "department": "OPS", "roles": ["employee"]},
    )
    assert viewer_resp.status_code == 200
    viewer_id = viewer_resp.json()["id"]

    problem_id = _create_problem_with_submitter_task(client, submitter_id)

    submit_resp = client.post(f"/problems/{problem_id}/submit-for-review", headers=_headers(submitter_id))
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

    all_problems_resp = client.get("/problems", headers=_headers(viewer_id))
    assert all_problems_resp.status_code == 200
    assert any(item["id"] == problem_id for item in all_problems_resp.json())

    mine_only_resp = client.get("/problems", headers=_headers(viewer_id), params={"mine_only": "true"})
    assert mine_only_resp.status_code == 200
    assert all(item["submitter_id"] == viewer_id for item in mine_only_resp.json())

    other_problem_detail_resp = client.get(f"/problems/{problem_id}", headers=_headers(viewer_id))
    assert other_problem_detail_resp.status_code == 200
    assert other_problem_detail_resp.json()["id"] == problem_id

    all_tasks_resp = client.get("/tasks", headers=_headers(viewer_id))
    assert all_tasks_resp.status_code == 200
    assert any(item["id"] == task_id for item in all_tasks_resp.json())

    other_task_detail_resp = client.get(f"/tasks/{task_id}", headers=_headers(viewer_id))
    assert other_task_detail_resp.status_code == 200
    assert other_task_detail_resp.json()["id"] == task_id

    app.dependency_overrides.clear()


def test_problem_analysis_and_hypotheses_transparency(tmp_path: Path, monkeypatch) -> None:
    client = _setup_client(tmp_path)

    submitter_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "AnalysisSubmitter", "employee_no": "E110", "department": "RD", "roles": ["employee"]},
    )
    assert submitter_resp.status_code == 200
    submitter_id = submitter_resp.json()["id"]

    viewer_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "AnalysisViewer", "employee_no": "F111", "department": "Finance", "roles": ["reward_approver"]},
    )
    assert viewer_resp.status_code == 200
    viewer_id = viewer_resp.json()["id"]

    problem_id = _create_problem_with_submitter_task(client, submitter_id)
    now = datetime.utcnow()
    fake_analysis = SimpleNamespace(
        id=901,
        problem_id=problem_id,
        status=AnalysisStatus.COMPLETED,
        recommendation="recommend",
        confidence=0.82,
        rounds=2,
        error_message=None,
        created_at=now,
        updated_at=now,
    )
    fake_hypothesis = SimpleNamespace(
        id=301,
        analysis_id=fake_analysis.id,
        hypothesis_content="Need broader rollout evidence",
        hypothesis_type=HypothesisType.REQUIREMENT,
        risk_level=RiskLevel.MEDIUM,
        verification_status=HypothesisStatus.VERIFIED,
        verification_method="pilot experiment",
        verification_result="weekly defects reduced by 35%",
        verified_by=submitter_id,
        verified_at=now,
        created_at=now,
    )

    monkeypatch.setattr(
        "app.routers.problems.get_problem_analysis",
        lambda _session, pid: fake_analysis if pid == problem_id else None,
    )
    monkeypatch.setattr(
        "app.routers.problems.get_analysis_report",
        lambda _analysis: {"summary": "synthetic analysis report"},
    )
    monkeypatch.setattr(
        "app.routers.problems.list_hypothesis_verifications",
        lambda _session, analysis_id: [fake_hypothesis] if analysis_id == fake_analysis.id else [],
    )

    analysis_resp = client.get(f"/problems/{problem_id}/analysis", headers=_headers(viewer_id))
    assert analysis_resp.status_code == 200
    assert analysis_resp.json()["id"] == fake_analysis.id
    assert analysis_resp.json()["problem_id"] == problem_id

    hypotheses_resp = client.get(f"/problems/{problem_id}/hypotheses", headers=_headers(viewer_id))
    assert hypotheses_resp.status_code == 200
    hypotheses_payload = hypotheses_resp.json()
    assert len(hypotheses_payload) == 1
    assert hypotheses_payload[0]["id"] == fake_hypothesis.id
    assert hypotheses_payload[0]["verification_status"] == "verified"
    assert hypotheses_payload[0]["verification_result"] == "weekly defects reduced by 35%"

    app.dependency_overrides.clear()
