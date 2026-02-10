import os
from datetime import date, timedelta
from io import BytesIO
from pathlib import Path

from fastapi.testclient import TestClient
from openpyxl import load_workbook
from sqlmodel import Session, SQLModel, create_engine

from app.db import get_session
from app.auth import create_access_token
from app.enums import Role
from app.main import app
from app.models import User, UserRole


def _headers(user_id: int) -> dict[str, str]:
    return {"X-User-Id": str(user_id)}


def _setup_client(tmp_path: Path) -> TestClient:
    db_file = tmp_path / "test.db"
    engine = create_engine(f"sqlite:///{db_file}", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        admin = User(id=1, name="Admin", employee_no="A001", department="PMO")
        session.add(admin)
        for role in [Role.ADMIN, Role.REVIEWER, Role.ACCEPTOR, Role.EMPLOYEE]:
            session.add(UserRole(user_id=1, role=role))
        session.commit()

    def override_session():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    return TestClient(app)


def _bearer_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_auth_login_and_bearer_access(tmp_path: Path) -> None:
    client = _setup_client(tmp_path)

    login_resp = client.post("/auth/login", json={"user_id": 1})
    assert login_resp.status_code == 200
    payload = login_resp.json()
    assert payload["token_type"] == "Bearer"
    assert payload["expires_in"] > 0
    assert payload["user"]["id"] == 1
    token = payload["access_token"]
    assert token

    me_resp = client.get("/me", headers=_bearer_headers(token))
    assert me_resp.status_code == 200
    assert me_resp.json()["id"] == 1

    app.dependency_overrides.clear()


def test_prod_auth_disables_passwordless_and_header_auth(tmp_path: Path) -> None:
    client = _setup_client(tmp_path)
    os.environ["APP_ENV"] = "production"
    os.environ.pop("AUTH_ENABLE_PASSWORDLESS_LOGIN", None)
    os.environ.pop("AUTH_ENABLE_HEADER_USER_ID", None)
    try:
        login_resp = client.post("/auth/login", json={"user_id": 1})
        assert login_resp.status_code == 403

        me_header_resp = client.get("/me", headers=_headers(1))
        assert me_header_resp.status_code == 401

        token, _ = create_access_token(1)
        me_bearer_resp = client.get("/me", headers=_bearer_headers(token))
        assert me_bearer_resp.status_code == 200
        assert me_bearer_resp.json()["id"] == 1
    finally:
        os.environ.pop("APP_ENV", None)
        os.environ.pop("AUTH_ENABLE_PASSWORDLESS_LOGIN", None)
        os.environ.pop("AUTH_ENABLE_HEADER_USER_ID", None)
        app.dependency_overrides.clear()


def test_end_to_end_flow(tmp_path: Path) -> None:
    client = _setup_client(tmp_path)

    reviewer_resp = client.post(
        "/users",
        headers=_headers(1),
        json={
            "name": "Reviewer",
            "employee_no": "R001",
            "department": "QA",
            "roles": ["reviewer", "acceptor", "employee"],
        },
    )
    assert reviewer_resp.status_code == 200
    reviewer_id = reviewer_resp.json()["id"]
    reviewer_detail_resp = client.get(f"/users/{reviewer_id}", headers=_headers(1))
    assert reviewer_detail_resp.status_code == 200
    assert reviewer_detail_resp.json()["id"] == reviewer_id

    employee_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "Alice", "employee_no": "E001", "department": "RD", "roles": ["employee"]},
    )
    assert employee_resp.status_code == 200
    employee_id = employee_resp.json()["id"]

    acceptor_list_resp = client.get("/users/acceptors", headers=_headers(reviewer_id))
    assert acceptor_list_resp.status_code == 200
    assert any(item["id"] == reviewer_id for item in acceptor_list_resp.json())

    acceptor_list_forbidden = client.get("/users/acceptors", headers=_headers(employee_id))
    assert acceptor_list_forbidden.status_code == 403

    me_resp = client.get("/me", headers=_headers(employee_id))
    assert me_resp.status_code == 200
    assert me_resp.json()["id"] == employee_id

    problem_resp = client.post(
        "/problems",
        headers=_headers(employee_id),
        json={
            "title": "构建流水线重复手工操作",
            "scenario": "rd",
            "background": "每次发布都需要重复点选流程",
            "frequency": "weekly",
            "impact_scope": "team",
            "description": "单次发布平均浪费20分钟",
            "value_reduce_effort": True,
            "value_statement": "自动化后每周可节省约2小时",
        },
    )
    assert problem_resp.status_code == 200
    problem_id = problem_resp.json()["id"]

    filtered_problem_resp = client.get(
        "/problems",
        headers=_headers(employee_id),
        params={
            "mine_only": "true",
            "status": "pending_review",
            "scenario": "rd",
            "created_from": date.today().isoformat(),
            "created_to": date.today().isoformat(),
        },
    )
    assert filtered_problem_resp.status_code == 200
    assert any(item["id"] == problem_id for item in filtered_problem_resp.json())

    task_due_date = (date.today() + timedelta(days=7)).isoformat()
    review_resp = client.post(
        f"/problems/{problem_id}/review",
        headers=_headers(reviewer_id),
        json={
            "approve": True,
            "task": {
                "title": "发布自动化脚本",
                "goal": "减少发布手工步骤",
                "scope": "实现发布脚本并接入流水线",
                "due_date": task_due_date,
                "level": "C",
                "reward_total": 600,
                "proposer_ratio": 0.3,
                "accepter_id": reviewer_id,
                "points": 20,
                "badge": "效率之星",
                "acceptance_criteria": [
                    {"description": "脚本稳定运行7天", "type": "quantified"},
                    {"description": "发布步骤由5步降到2步", "type": "behavioral"},
                ],
            },
        },
    )
    assert review_resp.status_code == 200
    task_id = review_resp.json()["id"]

    filtered_task_resp = client.get(
        "/tasks",
        headers=_headers(employee_id),
        params={
            "status": "open",
            "level": "C",
            "scenario": "rd",
            "reward_min": 500,
            "reward_max": 700,
        },
    )
    assert filtered_task_resp.status_code == 200
    task_rows = filtered_task_resp.json()
    target_task = next(item for item in task_rows if item["id"] == task_id)
    assert target_task["scenario"] == "rd"
    assert target_task["active_claim_count"] == 0

    task_detail_resp = client.get(f"/tasks/{task_id}", headers=_headers(employee_id))
    assert task_detail_resp.status_code == 200
    assert task_detail_resp.json()["id"] == task_id
    assert len(task_detail_resp.json()["acceptance_criteria"]) == 2

    claim_resp = client.post(
        f"/tasks/{task_id}/claims",
        headers=_headers(employee_id),
        json={"mode": "individual"},
    )
    assert claim_resp.status_code == 200
    claim_id = claim_resp.json()["claim_id"]

    task_in_progress_resp = client.get(
        "/tasks",
        headers=_headers(employee_id),
        params={"status": "in_progress", "scenario": "rd"},
    )
    assert task_in_progress_resp.status_code == 200
    in_progress_task = next(item for item in task_in_progress_resp.json() if item["id"] == task_id)
    assert in_progress_task["active_claim_count"] >= 1

    detail_owner_resp = client.get(f"/claims/{claim_id}/detail", headers=_headers(employee_id))
    assert detail_owner_resp.status_code == 200
    assert detail_owner_resp.json()["claim_id"] == claim_id

    detail_acceptor_resp = client.get(f"/claims/{claim_id}/detail", headers=_headers(reviewer_id))
    assert detail_acceptor_resp.status_code == 200

    outsider_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "Outsider", "employee_no": "E999", "department": "RD", "roles": ["employee"]},
    )
    outsider_id = outsider_resp.json()["id"]
    detail_forbidden_resp = client.get(f"/claims/{claim_id}/detail", headers=_headers(outsider_id))
    assert detail_forbidden_resp.status_code == 403

    my_claims_resp = client.get("/claims/mine", headers=_headers(employee_id))
    assert my_claims_resp.status_code == 200
    assert len(my_claims_resp.json()) >= 1

    deliverable_resp = client.post(
        f"/claims/{claim_id}/deliverables",
        headers=_headers(employee_id),
        json={
            "summary": "脚本已上线并接入流水线",
            "evidence_urls": ["https://example.com/screenshot-1"],
            "criteria_results": ["已连续稳定运行7天", "步骤从5步减少为2步"],
        },
    )
    assert deliverable_resp.status_code == 200
    deliverable_id = deliverable_resp.json()["deliverable_id"]

    pending_acceptance_resp = client.get(
        "/deliverables/pending-acceptance/mine",
        headers=_headers(reviewer_id),
    )
    assert pending_acceptance_resp.status_code == 200
    assert any(item["deliverable_id"] == deliverable_id for item in pending_acceptance_resp.json())

    accept_resp = client.post(
        f"/deliverables/{deliverable_id}/accept",
        headers=_headers(reviewer_id),
        json={"result": "approved", "comment": "验收通过"},
    )
    assert accept_resp.status_code == 200
    assert accept_resp.json()["task_status"] == "completed"

    rewards_resp = client.get("/rewards", headers=_headers(employee_id), params={"user_id": employee_id})
    assert rewards_resp.status_code == 200
    rewards = rewards_resp.json()
    assert len(rewards) == 2

    for reward in rewards:
        confirm_resp = client.post(f"/rewards/{reward['id']}/confirm", headers=_headers(reviewer_id))
        assert confirm_resp.status_code == 200
        assert confirm_resp.json()["status"] == "confirmed"

    me_summary_resp = client.get("/me/summary", headers=_headers(employee_id))
    assert me_summary_resp.status_code == 200
    me_summary = me_summary_resp.json()
    assert me_summary["user"]["id"] == employee_id
    assert me_summary["stats"]["total_records"] == 2
    assert me_summary["stats"]["confirmed_records"] == 2
    assert me_summary["stats"]["confirmed_reward_amount"] > 0
    assert me_summary["stats"]["confirmed_points"] >= 20
    assert isinstance(me_summary["badges"], list)
    assert len(me_summary["rewards"]) == 2

    knowledge_resp = client.get("/knowledge", headers=_headers(employee_id))
    assert knowledge_resp.status_code == 200
    knowledge_rows = knowledge_resp.json()
    assert len(knowledge_rows) == 1
    knowledge_id = knowledge_rows[0]["id"]

    knowledge_keyword_resp = client.get(
        "/knowledge",
        headers=_headers(employee_id),
        params={"keyword": "减少发布手工步骤"},
    )
    assert knowledge_keyword_resp.status_code == 200
    assert any(item["id"] == knowledge_id for item in knowledge_keyword_resp.json())

    knowledge_scenario_resp = client.get(
        "/knowledge",
        headers=_headers(employee_id),
        params={"scenario": "rd"},
    )
    assert knowledge_scenario_resp.status_code == 200
    assert any(item["id"] == knowledge_id for item in knowledge_scenario_resp.json())

    knowledge_level_resp = client.get(
        "/knowledge",
        headers=_headers(employee_id),
        params={"level": "C"},
    )
    assert knowledge_level_resp.status_code == 200
    assert any(item["id"] == knowledge_id for item in knowledge_level_resp.json())

    knowledge_recommended_resp = client.get(
        "/knowledge",
        headers=_headers(employee_id),
        params={"recommended": "false"},
    )
    assert knowledge_recommended_resp.status_code == 200
    assert any(item["id"] == knowledge_id for item in knowledge_recommended_resp.json())

    knowledge_detail_resp = client.get(f"/knowledge/{knowledge_id}", headers=_headers(employee_id))
    assert knowledge_detail_resp.status_code == 200
    assert knowledge_detail_resp.json()["id"] == knowledge_id

    dashboard_resp = client.get("/dashboard/overview", headers=_headers(employee_id))
    assert dashboard_resp.status_code == 200
    assert dashboard_resp.json()["task_completed"] == 1
    assert dashboard_resp.json()["task_completion_rate"] > 0
    assert "task_overdue_rate" in dashboard_resp.json()

    app.dependency_overrides.clear()


def test_release_overdue_claims(tmp_path: Path) -> None:
    client = _setup_client(tmp_path)

    get_freq_resp = client.get("/system/config/release-overdue-frequency", headers=_headers(1))
    assert get_freq_resp.status_code == 200
    assert get_freq_resp.json()["frequency_minutes"] >= 5

    put_freq_resp = client.put(
        "/system/config/release-overdue-frequency",
        headers=_headers(1),
        json={"frequency_minutes": 15},
    )
    assert put_freq_resp.status_code == 200
    assert put_freq_resp.json()["frequency_minutes"] == 15

    reviewer_resp = client.post(
        "/users",
        headers=_headers(1),
        json={
            "name": "Reviewer2",
            "employee_no": "R002",
            "department": "QA",
            "roles": ["reviewer", "acceptor", "employee"],
        },
    )
    reviewer_id = reviewer_resp.json()["id"]

    employee_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "Bob", "employee_no": "E002", "department": "RD", "roles": ["employee"]},
    )
    employee_id = employee_resp.json()["id"]

    problem_resp = client.post(
        "/problems",
        headers=_headers(employee_id),
        json={
            "title": "日志清理流程重复",
            "scenario": "ops",
            "background": "每周人工清理日志",
            "frequency": "weekly",
            "impact_scope": "department",
            "description": "易遗漏导致磁盘告警",
            "value_reduce_effort": True,
            "value_statement": "自动化可减少值班负担",
        },
    )
    problem_id = problem_resp.json()["id"]

    review_resp = client.post(
        f"/problems/{problem_id}/review",
        headers=_headers(reviewer_id),
        json={
            "approve": True,
            "task": {
                "title": "日志清理自动化",
                "goal": "自动化清理",
                "scope": "实现定时清理并留审计日志",
                "due_date": (date.today() - timedelta(days=1)).isoformat(),
                "level": "C",
                "reward_total": 300,
                "proposer_ratio": 0.2,
                "accepter_id": reviewer_id,
                "acceptance_criteria": [
                    {"description": "定时任务连续运行3天", "type": "quantified"}
                ],
            },
        },
    )
    task_id = review_resp.json()["id"]

    claim_resp = client.post(
        f"/tasks/{task_id}/claims",
        headers=_headers(employee_id),
        json={"mode": "individual"},
    )
    assert claim_resp.status_code == 200

    job_resp = client.post("/jobs/release-overdue", headers=_headers(reviewer_id))
    assert job_resp.status_code == 200
    assert job_resp.json()["released_claims"] >= 1

    app.dependency_overrides.clear()


def test_claim_overdue_approval_policy(tmp_path: Path) -> None:
    client = _setup_client(tmp_path)

    reviewer_resp = client.post(
        "/users",
        headers=_headers(1),
        json={
            "name": "ReviewerPolicy",
            "employee_no": "R040",
            "department": "QA",
            "roles": ["reviewer", "acceptor", "employee"],
        },
    )
    assert reviewer_resp.status_code == 200
    reviewer_id = reviewer_resp.json()["id"]

    employee_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "OverdueUser", "employee_no": "E040", "department": "RD", "roles": ["employee"]},
    )
    assert employee_resp.status_code == 200
    employee_id = employee_resp.json()["id"]

    get_threshold_resp = client.get(
        "/system/config/claim-approval-overdue-threshold",
        headers=_headers(reviewer_id),
    )
    assert get_threshold_resp.status_code == 200
    assert get_threshold_resp.json()["threshold"] >= 1

    set_threshold_resp = client.put(
        "/system/config/claim-approval-overdue-threshold",
        headers=_headers(1),
        json={"threshold": 1},
    )
    assert set_threshold_resp.status_code == 200
    assert set_threshold_resp.json()["threshold"] == 1

    first_problem_resp = client.post(
        "/problems",
        headers=_headers(employee_id),
        json={
            "title": "overdue policy first task",
            "scenario": "ops",
            "background": "prepare overdue count",
            "frequency": "weekly",
            "impact_scope": "team",
            "description": "claim first task and let it overdue",
            "value_reduce_effort": True,
            "value_statement": "exercise overdue path",
        },
    )
    assert first_problem_resp.status_code == 200
    first_problem_id = first_problem_resp.json()["id"]

    first_review_resp = client.post(
        f"/problems/{first_problem_id}/review",
        headers=_headers(reviewer_id),
        json={
            "approve": True,
            "task": {
                "title": "overdue seed task",
                "goal": "seed overdue counter",
                "scope": "single task",
                "due_date": (date.today() - timedelta(days=1)).isoformat(),
                "level": "C",
                "reward_total": 300,
                "proposer_ratio": 0.2,
                "accepter_id": reviewer_id,
                "acceptance_criteria": [{"description": "create overdue claim", "type": "quantified"}],
            },
        },
    )
    assert first_review_resp.status_code == 200
    first_task_id = first_review_resp.json()["id"]

    first_claim_resp = client.post(
        f"/tasks/{first_task_id}/claims",
        headers=_headers(employee_id),
        json={"mode": "individual"},
    )
    assert first_claim_resp.status_code == 200

    release_resp = client.post("/jobs/release-overdue", headers=_headers(reviewer_id))
    assert release_resp.status_code == 200
    assert release_resp.json()["released_claims"] >= 1

    employee_detail_resp = client.get(f"/users/{employee_id}", headers=_headers(1))
    assert employee_detail_resp.status_code == 200
    assert employee_detail_resp.json()["overdue_count"] >= 1

    second_problem_resp = client.post(
        "/problems",
        headers=_headers(employee_id),
        json={
            "title": "overdue policy second task",
            "scenario": "rd",
            "background": "verify approval gate",
            "frequency": "weekly",
            "impact_scope": "team",
            "description": "self claim should be blocked after overdue threshold",
            "value_reduce_effort": True,
            "value_statement": "validate approval strategy",
        },
    )
    assert second_problem_resp.status_code == 200
    second_problem_id = second_problem_resp.json()["id"]

    second_review_resp = client.post(
        f"/problems/{second_problem_id}/review",
        headers=_headers(reviewer_id),
        json={
            "approve": True,
            "task": {
                "title": "approval required task",
                "goal": "enforce approval for overdue users",
                "scope": "single task",
                "due_date": (date.today() + timedelta(days=2)).isoformat(),
                "level": "C",
                "reward_total": 400,
                "proposer_ratio": 0.2,
                "accepter_id": reviewer_id,
                "acceptance_criteria": [{"description": "self claim blocked", "type": "quantified"}],
            },
        },
    )
    assert second_review_resp.status_code == 200
    second_task_id = second_review_resp.json()["id"]

    blocked_claim_resp = client.post(
        f"/tasks/{second_task_id}/claims",
        headers=_headers(employee_id),
        json={"mode": "individual"},
    )
    assert blocked_claim_resp.status_code == 403
    assert "approval" in blocked_claim_resp.text.lower()
    my_requests_resp = client.get(
        "/claims/overdue-approvals/mine",
        headers=_headers(employee_id),
        params={"status": "pending"},
    )
    assert my_requests_resp.status_code == 200
    pending_rows = my_requests_resp.json()
    target_request = next(item for item in pending_rows if item["task_id"] == second_task_id)
    request_id = target_request["id"]

    reviewer_pending_resp = client.get(
        "/claims/overdue-approvals/pending",
        headers=_headers(reviewer_id),
        params={"status": "pending"},
    )
    assert reviewer_pending_resp.status_code == 200
    assert any(item["id"] == request_id for item in reviewer_pending_resp.json())

    approve_resp = client.post(
        f"/claims/overdue-approvals/{request_id}/approve",
        headers=_headers(reviewer_id),
        json={"comment": "approved by reviewer"},
    )
    assert approve_resp.status_code == 200
    assert approve_resp.json()["status"] == "approved"
    assert approve_resp.json()["task_id"] == second_task_id

    approved_list_resp = client.get(
        "/claims/overdue-approvals/pending",
        headers=_headers(reviewer_id),
        params={"status": "approved"},
    )
    assert approved_list_resp.status_code == 200
    assert any(item["id"] == request_id for item in approved_list_resp.json())

    third_problem_resp = client.post(
        "/problems",
        headers=_headers(employee_id),
        json={
            "title": "overdue policy third task",
            "scenario": "support",
            "background": "verify reject flow",
            "frequency": "weekly",
            "impact_scope": "team",
            "description": "self claim should create request then reviewer rejects",
            "value_reduce_effort": True,
            "value_statement": "validate reject strategy",
        },
    )
    assert third_problem_resp.status_code == 200
    third_problem_id = third_problem_resp.json()["id"]
    third_review_resp = client.post(
        f"/problems/{third_problem_id}/review",
        headers=_headers(reviewer_id),
        json={
            "approve": True,
            "task": {
                "title": "approval reject task",
                "goal": "reject overdue request",
                "scope": "single task",
                "due_date": (date.today() + timedelta(days=3)).isoformat(),
                "level": "C",
                "reward_total": 500,
                "proposer_ratio": 0.2,
                "accepter_id": reviewer_id,
                "acceptance_criteria": [{"description": "request can be rejected", "type": "quantified"}],
            },
        },
    )
    assert third_review_resp.status_code == 200
    third_task_id = third_review_resp.json()["id"]

    blocked_third_resp = client.post(
        f"/tasks/{third_task_id}/claims",
        headers=_headers(employee_id),
        json={"mode": "individual"},
    )
    assert blocked_third_resp.status_code == 403

    third_request_resp = client.get(
        "/claims/overdue-approvals/mine",
        headers=_headers(employee_id),
        params={"status": "pending"},
    )
    assert third_request_resp.status_code == 200
    third_request = next(item for item in third_request_resp.json() if item["task_id"] == third_task_id)
    third_request_id = third_request["id"]

    reject_resp = client.post(
        f"/claims/overdue-approvals/{third_request_id}/reject",
        headers=_headers(reviewer_id),
        json={"comment": "rejected by reviewer"},
    )
    assert reject_resp.status_code == 200
    assert reject_resp.json()["status"] == "rejected"

    app.dependency_overrides.clear()


def test_dashboard_and_export_endpoints(tmp_path: Path) -> None:
    client = _setup_client(tmp_path)

    reviewer_resp = client.post(
        "/users",
        headers=_headers(1),
        json={
            "name": "ReviewX",
            "employee_no": "R010",
            "department": "QA",
            "roles": ["reviewer", "acceptor", "employee"],
        },
    )
    reviewer_id = reviewer_resp.json()["id"]

    employee_resp = client.post(
        "/users",
        headers=_headers(1),
        json={
            "name": "DevX",
            "employee_no": "E010",
            "department": "RD",
            "roles": ["employee"],
        },
    )
    employee_id = employee_resp.json()["id"]

    problem_resp = client.post(
        "/problems",
        headers=_headers(employee_id),
        json={
            "title": "pipeline script optimization",
            "scenario": "rd",
            "background": "manual release is repetitive",
            "frequency": "weekly",
            "impact_scope": "team",
            "description": "release requires repeated clicks",
            "value_reduce_effort": True,
            "value_statement": "save team time every week",
        },
    )
    problem_id = problem_resp.json()["id"]

    review_resp = client.post(
        f"/problems/{problem_id}/review",
        headers=_headers(reviewer_id),
        json={
            "approve": True,
            "task": {
                "title": "automate release",
                "goal": "reduce manual release operations",
                "scope": "script + ci integration",
                "due_date": (date.today() + timedelta(days=3)).isoformat(),
                "level": "C",
                "reward_total": 800,
                "proposer_ratio": 0.25,
                "accepter_id": reviewer_id,
                "points": 30,
                "badge": "efficiency-star",
                "acceptance_criteria": [
                    {"description": "script runs stably", "type": "quantified"}
                ],
            },
        },
    )
    task_id = review_resp.json()["id"]

    claim_resp = client.post(
        f"/tasks/{task_id}/claims",
        headers=_headers(employee_id),
        json={"mode": "individual"},
    )
    claim_id = claim_resp.json()["claim_id"]

    deliverable_resp = client.post(
        f"/claims/{claim_id}/deliverables",
        headers=_headers(employee_id),
        json={
            "summary": "done",
            "evidence_urls": ["https://example.com/evidence"],
            "criteria_results": ["met"],
        },
    )
    deliverable_id = deliverable_resp.json()["deliverable_id"]

    client.post(
        f"/deliverables/{deliverable_id}/accept",
        headers=_headers(reviewer_id),
        json={"result": "approved", "comment": "ok"},
    )
    perf_resp = client.put(
        f"/claims/{claim_id}/performance-review",
        headers=_headers(reviewer_id),
        json={
            "has_t3_plus_task": True,
            "initial_r_level": "R4",
            "signals": {
                "incident_severity": "minor",
                "incident_count": 2,
                "missed_deadline_count": 0,
                "unjustified_delay_count": 0,
                "process_violation_count": 0,
                "known_risk_unreported": False,
                "repeated_issue_count": 0,
                "critical_task_missed_without_reason": False,
                "repeated_issue_without_improvement": False,
            },
        },
    )
    assert perf_resp.status_code == 200

    rewards_resp = client.get("/rewards", headers=_headers(1))
    reward_id = rewards_resp.json()[0]["id"]
    client.post(f"/rewards/{reward_id}/confirm", headers=_headers(reviewer_id))

    rankings_resp = client.get("/dashboard/rankings", headers=_headers(1), params={"time_range": "all"})
    assert rankings_resp.status_code == 200
    assert "claim_count_ranking" in rankings_resp.json()

    trends_resp = client.get(
        "/dashboard/trends",
        headers=_headers(1),
        params={"time_range": "all", "granularity": "month"},
    )
    assert trends_resp.status_code == 200
    assert len(trends_resp.json()["points"]) >= 1

    dist_resp = client.get("/dashboard/distribution", headers=_headers(1), params={"time_range": "all"})
    assert dist_resp.status_code == 200
    assert "scenario_distribution" in dist_resp.json()
    assert "baseline_responsibility_distribution" in dist_resp.json()
    assert "final_r_level_distribution" in dist_resp.json()

    tasks_export = client.get("/exports/tasks.xlsx", headers=_headers(1))
    assert tasks_export.status_code == 200
    tasks_wb = load_workbook(BytesIO(tasks_export.content))
    assert "Tasks" in tasks_wb.sheetnames
    assert "PerformanceReviews" in tasks_wb.sheetnames

    rewards_export = client.get("/exports/rewards.xlsx", headers=_headers(1))
    assert rewards_export.status_code == 200
    rewards_wb = load_workbook(BytesIO(rewards_export.content))
    rewards_headers = [cell.value for cell in rewards_wb["Rewards"][1]]
    assert "performance_final_r_level" in rewards_headers
    assert "hold_reason" in rewards_headers

    dashboard_export = client.get(
        "/exports/dashboard.xlsx",
        headers=_headers(1),
        params={"time_range": "all", "granularity": "month"},
    )
    assert dashboard_export.status_code == 200
    dashboard_wb = load_workbook(BytesIO(dashboard_export.content))
    assert "Rankings" in dashboard_wb.sheetnames

    knowledge_pdf = client.get("/exports/knowledge.pdf", headers=_headers(1))
    assert knowledge_pdf.status_code == 200
    assert knowledge_pdf.content.startswith(b"%PDF")

    app.dependency_overrides.clear()


def test_user_status_update_and_disable_effect(tmp_path: Path) -> None:
    client = _setup_client(tmp_path)

    employee_resp = client.post(
        "/users",
        headers=_headers(1),
        json={
            "name": "StatusUser",
            "employee_no": "E020",
            "department": "RD",
            "roles": ["employee"],
        },
    )
    assert employee_resp.status_code == 200
    employee_id = employee_resp.json()["id"]

    disable_resp = client.put(
        f"/users/{employee_id}/status",
        headers=_headers(1),
        json={"status": "disabled"},
    )
    assert disable_resp.status_code == 200
    assert disable_resp.json()["status"] == "disabled"

    blocked_problem_resp = client.post(
        "/problems",
        headers=_headers(employee_id),
        json={
            "title": "disabled user should be blocked",
            "scenario": "rd",
            "background": "x",
            "frequency": "weekly",
            "impact_scope": "team",
            "description": "x",
            "value_reduce_effort": True,
            "value_statement": "x",
        },
    )
    assert blocked_problem_resp.status_code == 403

    enable_resp = client.put(
        f"/users/{employee_id}/status",
        headers=_headers(1),
        json={"status": "enabled"},
    )
    assert enable_resp.status_code == 200
    assert enable_resp.json()["status"] == "enabled"

    active_users_before_disable = client.get("/users/active", headers=_headers(employee_id))
    assert active_users_before_disable.status_code == 200
    assert any(item["id"] == employee_id for item in active_users_before_disable.json())

    allowed_problem_resp = client.post(
        "/problems",
        headers=_headers(employee_id),
        json={
            "title": "enabled user can submit",
            "scenario": "rd",
            "background": "x",
            "frequency": "weekly",
            "impact_scope": "team",
            "description": "x",
            "value_reduce_effort": True,
            "value_statement": "x",
        },
    )
    assert allowed_problem_resp.status_code == 200

    non_admin_update_resp = client.put(
        f"/users/{employee_id}/status",
        headers=_headers(employee_id),
        json={"status": "disabled"},
    )
    assert non_admin_update_resp.status_code == 403

    disable_again_resp = client.put(
        f"/users/{employee_id}/status",
        headers=_headers(1),
        json={"status": "disabled"},
    )
    assert disable_again_resp.status_code == 200

    active_users_after_disable = client.get("/users/active", headers=_headers(1))
    assert active_users_after_disable.status_code == 200
    assert all(item["id"] != employee_id for item in active_users_after_disable.json())

    app.dependency_overrides.clear()


def test_abandon_claim_flow(tmp_path: Path) -> None:
    client = _setup_client(tmp_path)

    reviewer_resp = client.post(
        "/users",
        headers=_headers(1),
        json={
            "name": "ReviewerAbandon",
            "employee_no": "R030",
            "department": "QA",
            "roles": ["reviewer", "acceptor", "employee"],
        },
    )
    reviewer_id = reviewer_resp.json()["id"]

    employee_a_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "DevA", "employee_no": "E031", "department": "RD", "roles": ["employee"]},
    )
    employee_a_id = employee_a_resp.json()["id"]

    employee_b_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "DevB", "employee_no": "E032", "department": "RD", "roles": ["employee"]},
    )
    employee_b_id = employee_b_resp.json()["id"]

    problem_resp = client.post(
        "/problems",
        headers=_headers(employee_a_id),
        json={
            "title": "abandon claim case",
            "scenario": "rd",
            "background": "need verify abandon workflow",
            "frequency": "weekly",
            "impact_scope": "team",
            "description": "abandon should reopen task when no active claim",
            "value_reduce_effort": True,
            "value_statement": "validate reopen behavior",
        },
    )
    problem_id = problem_resp.json()["id"]

    review_resp = client.post(
        f"/problems/{problem_id}/review",
        headers=_headers(reviewer_id),
        json={
            "approve": True,
            "task": {
                "title": "review abandon behavior",
                "goal": "support abandon operation",
                "scope": "single workflow",
                "due_date": (date.today() + timedelta(days=2)).isoformat(),
                "level": "C",
                "reward_total": 300,
                "proposer_ratio": 0.2,
                "accepter_id": reviewer_id,
                "acceptance_criteria": [{"description": "flow works", "type": "quantified"}],
            },
        },
    )
    task_id = review_resp.json()["id"]

    claim_a_resp = client.post(
        f"/tasks/{task_id}/claims",
        headers=_headers(employee_a_id),
        json={"mode": "individual"},
    )
    claim_a_id = claim_a_resp.json()["claim_id"]

    claim_b_resp = client.post(
        f"/tasks/{task_id}/claims",
        headers=_headers(employee_b_id),
        json={"mode": "individual"},
    )
    claim_b_id = claim_b_resp.json()["claim_id"]

    forbidden_abandon = client.post(f"/claims/{claim_b_id}/abandon", headers=_headers(employee_a_id))
    assert forbidden_abandon.status_code == 403

    abandon_a_resp = client.post(f"/claims/{claim_a_id}/abandon", headers=_headers(employee_a_id))
    assert abandon_a_resp.status_code == 200
    assert abandon_a_resp.json()["status"] == "abandoned"
    assert abandon_a_resp.json()["task_status"] == "in_progress"

    abandon_b_resp = client.post(f"/claims/{claim_b_id}/abandon", headers=_headers(employee_b_id))
    assert abandon_b_resp.status_code == 200
    assert abandon_b_resp.json()["status"] == "abandoned"
    assert abandon_b_resp.json()["task_status"] == "open"

    reopen_tasks_resp = client.get("/tasks", headers=_headers(employee_a_id), params={"status": "open"})
    assert reopen_tasks_resp.status_code == 200
    assert any(item["id"] == task_id for item in reopen_tasks_resp.json())

    app.dependency_overrides.clear()


def test_system_config_overview_and_operation_logs(tmp_path: Path) -> None:
    client = _setup_client(tmp_path)

    reviewer_resp = client.post(
        "/users",
        headers=_headers(1),
        json={
            "name": "LogReviewer",
            "employee_no": "R050",
            "department": "QA",
            "roles": ["reviewer", "acceptor", "employee"],
        },
    )
    assert reviewer_resp.status_code == 200
    reviewer_id = reviewer_resp.json()["id"]

    overview_resp = client.get("/system/config/overview", headers=_headers(reviewer_id))
    assert overview_resp.status_code == 200
    overview = overview_resp.json()
    assert overview["feishu_sync_frequency_minutes"] >= 5
    assert overview["release_overdue_frequency_minutes"] >= 5
    assert overview["claim_approval_overdue_threshold"] >= 1
    assert "acceptance_templates" in overview

    logs_resp = client.get(
        "/operations/logs",
        headers=_headers(reviewer_id),
        params={"action": "user.create", "limit": 50},
    )
    assert logs_resp.status_code == 200
    rows = logs_resp.json()
    assert any(item["action"] == "user.create" for item in rows)

    app.dependency_overrides.clear()


def test_performance_review_snapshot_and_fusion_rules(tmp_path: Path) -> None:
    client = _setup_client(tmp_path)

    reviewer_resp = client.post(
        "/users",
        headers=_headers(1),
        json={
            "name": "PerfReviewer",
            "employee_no": "R901",
            "department": "QA",
            "roles": ["reviewer", "acceptor", "employee"],
        },
    )
    assert reviewer_resp.status_code == 200
    reviewer_id = reviewer_resp.json()["id"]

    employee_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "PerfDev", "employee_no": "E901", "department": "RD", "roles": ["employee"]},
    )
    assert employee_resp.status_code == 200
    employee_id = employee_resp.json()["id"]

    problem_resp = client.post(
        "/problems",
        headers=_headers(employee_id),
        json={
            "title": "performance review baseline case",
            "scenario": "rd",
            "background": "validate supplemental requirements",
            "frequency": "weekly",
            "impact_scope": "team",
            "description": "need verify baseline responsibility and R fusion",
            "value_reduce_effort": True,
            "value_statement": "add auditable snapshot and fusion logic",
        },
    )
    assert problem_resp.status_code == 200
    problem_id = problem_resp.json()["id"]

    review_resp = client.post(
        f"/problems/{problem_id}/review",
        headers=_headers(reviewer_id),
        json={
            "approve": True,
            "task": {
                "title": "performance review task",
                "goal": "verify baseline/fault integration",
                "scope": "single workflow",
                "due_date": (date.today() + timedelta(days=3)).isoformat(),
                "level": "B",
                "reward_total": 1500,
                "proposer_ratio": 0.2,
                "accepter_id": reviewer_id,
                "acceptance_criteria": [{"description": "workflow completed", "type": "quantified"}],
            },
        },
    )
    assert review_resp.status_code == 200
    task_id = review_resp.json()["id"]

    claim_resp = client.post(
        f"/tasks/{task_id}/claims",
        headers=_headers(employee_id),
        json={"mode": "individual"},
    )
    assert claim_resp.status_code == 200
    claim_id = claim_resp.json()["claim_id"]
    assert isinstance(claim_id, int)

    deliverable_resp = client.post(
        f"/claims/{claim_id}/deliverables",
        headers=_headers(employee_id),
        json={
            "summary": "submitted for performance review",
            "evidence_urls": ["https://example.com/perf-review"],
            "criteria_results": ["done"],
        },
    )
    assert deliverable_resp.status_code == 200

    pre_detail_resp = client.get(f"/claims/{claim_id}/detail", headers=_headers(reviewer_id))
    assert pre_detail_resp.status_code == 200, pre_detail_resp.text

    fault_snapshot_resp = client.put(
        f"/claims/{claim_id}/performance-review",
        headers=_headers(reviewer_id),
        json={
            "has_t3_plus_task": False,
            "initial_r_level": "R5",
            "signals": {
                "incident_severity": "major",
                "incident_count": 1,
                "missed_deadline_count": 0,
                "unjustified_delay_count": 0,
                "process_violation_count": 0,
                "known_risk_unreported": False,
                "repeated_issue_count": 0,
                "critical_task_missed_without_reason": False,
                "repeated_issue_without_improvement": False,
            },
        },
    )
    assert fault_snapshot_resp.status_code == 200
    fault_snapshot = fault_snapshot_resp.json()
    assert fault_snapshot["baseline_responsibility_status"] == "fault"
    assert fault_snapshot["final_r_level"] == "R2"
    assert fault_snapshot["has_fault_warning"] is True
    assert len(fault_snapshot["baseline_reasons"]) >= 1

    get_snapshot_resp = client.get(
        f"/claims/{claim_id}/performance-review",
        headers=_headers(employee_id),
    )
    assert get_snapshot_resp.status_code == 200
    assert get_snapshot_resp.json()["baseline_responsibility_status"] == "fault"

    accept_resp = client.post(
        f"/deliverables/{deliverable_resp.json()['deliverable_id']}/accept",
        headers=_headers(reviewer_id),
        json={"result": "approved", "comment": "approve for reward policy test"},
    )
    assert accept_resp.status_code == 200

    rewards_resp = client.get("/rewards", headers=_headers(reviewer_id), params={"user_id": employee_id})
    assert rewards_resp.status_code == 200
    reward_rows = rewards_resp.json()
    executor_reward = next(item for item in reward_rows if item["role_type"] == "executor")
    proposer_reward = next(item for item in reward_rows if item["role_type"] == "proposer")
    assert executor_reward["held_by_performance_policy"] is True
    assert executor_reward["performance_final_r_level"] == "R2"
    assert executor_reward["hold_reason"]
    assert proposer_reward["held_by_performance_policy"] is False

    held_only_resp = client.get("/rewards", headers=_headers(reviewer_id), params={"held_only": "true"})
    assert held_only_resp.status_code == 200
    held_rows = held_only_resp.json()
    assert any(item["id"] == executor_reward["id"] for item in held_rows)
    assert all(item["held_by_performance_policy"] is True for item in held_rows)

    generated_only_resp = client.get("/rewards", headers=_headers(reviewer_id), params={"status": "generated"})
    assert generated_only_resp.status_code == 200
    assert any(item["id"] == executor_reward["id"] for item in generated_only_resp.json())

    invalid_status_resp = client.get("/rewards", headers=_headers(reviewer_id), params={"status": "bad"})
    assert invalid_status_resp.status_code == 400

    reviewer_confirm_blocked = client.post(
        f"/rewards/{executor_reward['id']}/confirm",
        headers=_headers(reviewer_id),
    )
    assert reviewer_confirm_blocked.status_code == 403

    admin_confirm_override = client.post(
        f"/rewards/{executor_reward['id']}/confirm",
        headers=_headers(1),
    )
    assert admin_confirm_override.status_code == 200
    assert admin_confirm_override.json()["status"] == "confirmed"

    normal_snapshot_resp = client.put(
        f"/claims/{claim_id}/performance-review",
        headers=_headers(reviewer_id),
        json={
            "has_t3_plus_task": True,
            "initial_r_level": "R4",
            "signals": {
                "incident_severity": "minor",
                "incident_count": 2,
                "missed_deadline_count": 0,
                "unjustified_delay_count": 1,
                "process_violation_count": 0,
                "known_risk_unreported": False,
                "repeated_issue_count": 1,
                "critical_task_missed_without_reason": False,
                "repeated_issue_without_improvement": False,
            },
        },
    )
    assert normal_snapshot_resp.status_code == 200
    normal_snapshot = normal_snapshot_resp.json()
    assert normal_snapshot["baseline_responsibility_status"] == "normal"
    assert normal_snapshot["final_r_level"] == "R3"
    assert normal_snapshot["has_fault_warning"] is False

    good_snapshot_resp = client.put(
        f"/claims/{claim_id}/performance-review",
        headers=_headers(reviewer_id),
        json={
            "has_t3_plus_task": False,
            "initial_r_level": "R5",
            "signals": {
                "incident_severity": "none",
                "incident_count": 0,
                "missed_deadline_count": 0,
                "unjustified_delay_count": 0,
                "process_violation_count": 0,
                "known_risk_unreported": False,
                "repeated_issue_count": 0,
                "critical_task_missed_without_reason": False,
                "repeated_issue_without_improvement": False,
            },
        },
    )
    assert good_snapshot_resp.status_code == 200
    good_snapshot = good_snapshot_resp.json()
    assert good_snapshot["baseline_responsibility_status"] == "good"
    assert good_snapshot["final_r_level"] == "R3"

    detail_resp = client.get(f"/claims/{claim_id}/detail", headers=_headers(employee_id))
    assert detail_resp.status_code == 200
    assert detail_resp.json()["performance_review"]["baseline_responsibility_status"] == "good"
    assert detail_resp.json()["performance_review"]["final_r_level"] == "R3"

    dashboard_resp = client.get("/dashboard/overview", headers=_headers(employee_id))
    assert dashboard_resp.status_code == 200
    dashboard = dashboard_resp.json()
    assert dashboard["performance_review_count"] >= 1
    assert dashboard["performance_fault_count"] >= 0
    assert "reward_hold_count" in dashboard

    distribution_resp = client.get("/dashboard/distribution", headers=_headers(employee_id), params={"time_range": "all"})
    assert distribution_resp.status_code == 200
    distribution = distribution_resp.json()
    assert "baseline_responsibility_distribution" in distribution
    assert "final_r_level_distribution" in distribution

    outsider_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "PerfOutsider", "employee_no": "E902", "department": "RD", "roles": ["employee"]},
    )
    assert outsider_resp.status_code == 200
    outsider_id = outsider_resp.json()["id"]
    forbidden_put_resp = client.put(
        f"/claims/{claim_id}/performance-review",
        headers=_headers(outsider_id),
        json={
            "has_t3_plus_task": False,
            "initial_r_level": "R3",
            "signals": {
                "incident_severity": "none",
                "incident_count": 0,
                "missed_deadline_count": 0,
                "unjustified_delay_count": 0,
                "process_violation_count": 0,
                "known_risk_unreported": False,
                "repeated_issue_count": 0,
                "critical_task_missed_without_reason": False,
                "repeated_issue_without_improvement": False,
            },
        },
    )
    assert forbidden_put_resp.status_code == 403

    app.dependency_overrides.clear()


def test_problem_review_concurrent_guard(tmp_path: Path) -> None:
    client = _setup_client(tmp_path)

    reviewer_resp = client.post(
        "/users",
        headers=_headers(1),
        json={
            "name": "ReviewGuard",
            "employee_no": "R801",
            "department": "QA",
            "roles": ["reviewer", "acceptor", "employee"],
        },
    )
    assert reviewer_resp.status_code == 200
    reviewer_id = reviewer_resp.json()["id"]

    employee_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "GuardDev", "employee_no": "E801", "department": "RD", "roles": ["employee"]},
    )
    assert employee_resp.status_code == 200
    employee_id = employee_resp.json()["id"]

    problem_resp = client.post(
        "/problems",
        headers=_headers(employee_id),
        json={
            "title": "review guard problem",
            "scenario": "rd",
            "background": "guard",
            "frequency": "weekly",
            "impact_scope": "team",
            "description": "review once only",
            "value_reduce_effort": True,
            "value_statement": "guard duplicated review",
        },
    )
    assert problem_resp.status_code == 200
    problem_id = problem_resp.json()["id"]

    first_review_resp = client.post(
        f"/problems/{problem_id}/review",
        headers=_headers(reviewer_id),
        json={
            "approve": True,
            "task": {
                "title": "review guard task",
                "goal": "guard",
                "scope": "single",
                "due_date": (date.today() + timedelta(days=3)).isoformat(),
                "level": "C",
                "reward_total": 300,
                "proposer_ratio": 0.2,
                "accepter_id": reviewer_id,
                "acceptance_criteria": [{"description": "ok", "type": "quantified"}],
            },
        },
    )
    assert first_review_resp.status_code == 200

    second_review_resp = client.post(
        f"/problems/{problem_id}/review",
        headers=_headers(reviewer_id),
        json={"approve": False, "reject_reason": "second review should fail"},
    )
    assert second_review_resp.status_code == 409

    app.dependency_overrides.clear()


def test_rejected_deliverable_keeps_task_in_progress_with_other_active_claims(tmp_path: Path) -> None:
    client = _setup_client(tmp_path)

    reviewer_resp = client.post(
        "/users",
        headers=_headers(1),
        json={
            "name": "RejectReviewer",
            "employee_no": "R811",
            "department": "QA",
            "roles": ["reviewer", "acceptor", "employee"],
        },
    )
    assert reviewer_resp.status_code == 200
    reviewer_id = reviewer_resp.json()["id"]

    owner_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "Owner811", "employee_no": "E811", "department": "RD", "roles": ["employee"]},
    )
    assert owner_resp.status_code == 200
    owner_id = owner_resp.json()["id"]

    peer_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "Peer811", "employee_no": "E812", "department": "RD", "roles": ["employee"]},
    )
    assert peer_resp.status_code == 200
    peer_id = peer_resp.json()["id"]

    problem_resp = client.post(
        "/problems",
        headers=_headers(owner_id),
        json={
            "title": "reject keep progress",
            "scenario": "rd",
            "background": "reject one claim",
            "frequency": "weekly",
            "impact_scope": "team",
            "description": "task should remain in progress when another claim is active",
            "value_reduce_effort": True,
            "value_statement": "status transition guard",
        },
    )
    assert problem_resp.status_code == 200
    problem_id = problem_resp.json()["id"]

    review_resp = client.post(
        f"/problems/{problem_id}/review",
        headers=_headers(reviewer_id),
        json={
            "approve": True,
            "task": {
                "title": "reject status task",
                "goal": "test status",
                "scope": "single",
                "due_date": (date.today() + timedelta(days=3)).isoformat(),
                "level": "C",
                "reward_total": 300,
                "proposer_ratio": 0.2,
                "accepter_id": reviewer_id,
                "acceptance_criteria": [{"description": "ok", "type": "quantified"}],
            },
        },
    )
    assert review_resp.status_code == 200
    task_id = review_resp.json()["id"]

    claim_owner_resp = client.post(
        f"/tasks/{task_id}/claims",
        headers=_headers(owner_id),
        json={"mode": "individual"},
    )
    assert claim_owner_resp.status_code == 200
    claim_owner_id = claim_owner_resp.json()["claim_id"]

    claim_peer_resp = client.post(
        f"/tasks/{task_id}/claims",
        headers=_headers(peer_id),
        json={"mode": "individual"},
    )
    assert claim_peer_resp.status_code == 200

    deliverable_resp = client.post(
        f"/claims/{claim_owner_id}/deliverables",
        headers=_headers(owner_id),
        json={
            "summary": "to be rejected",
            "criteria_results": ["not enough"],
            "evidence_urls": [],
        },
    )
    assert deliverable_resp.status_code == 200
    deliverable_id = deliverable_resp.json()["deliverable_id"]

    reject_resp = client.post(
        f"/deliverables/{deliverable_id}/accept",
        headers=_headers(reviewer_id),
        json={"result": "rejected", "comment": "reject this claim"},
    )
    assert reject_resp.status_code == 200
    assert reject_resp.json()["task_status"] == "in_progress"

    in_progress_resp = client.get("/tasks", headers=_headers(owner_id), params={"status": "in_progress"})
    assert in_progress_resp.status_code == 200
    assert any(item["id"] == task_id for item in in_progress_resp.json())

    app.dependency_overrides.clear()


def test_release_overdue_boundary_due_today_is_not_overdue(tmp_path: Path) -> None:
    client = _setup_client(tmp_path)

    reviewer_resp = client.post(
        "/users",
        headers=_headers(1),
        json={
            "name": "BoundaryReviewer",
            "employee_no": "R821",
            "department": "QA",
            "roles": ["reviewer", "acceptor", "employee"],
        },
    )
    assert reviewer_resp.status_code == 200
    reviewer_id = reviewer_resp.json()["id"]

    employee_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "BoundaryDev", "employee_no": "E821", "department": "RD", "roles": ["employee"]},
    )
    assert employee_resp.status_code == 200
    employee_id = employee_resp.json()["id"]

    problem_resp = client.post(
        "/problems",
        headers=_headers(employee_id),
        json={
            "title": "overdue boundary problem",
            "scenario": "ops",
            "background": "boundary",
            "frequency": "weekly",
            "impact_scope": "team",
            "description": "due today should not be overdue",
            "value_reduce_effort": True,
            "value_statement": "boundary test",
        },
    )
    assert problem_resp.status_code == 200
    problem_id = problem_resp.json()["id"]

    review_resp = client.post(
        f"/problems/{problem_id}/review",
        headers=_headers(reviewer_id),
        json={
            "approve": True,
            "task": {
                "title": "boundary task",
                "goal": "boundary",
                "scope": "single",
                "due_date": date.today().isoformat(),
                "level": "C",
                "reward_total": 300,
                "proposer_ratio": 0.2,
                "accepter_id": reviewer_id,
                "acceptance_criteria": [{"description": "ok", "type": "quantified"}],
            },
        },
    )
    assert review_resp.status_code == 200
    task_id = review_resp.json()["id"]

    claim_resp = client.post(
        f"/tasks/{task_id}/claims",
        headers=_headers(employee_id),
        json={"mode": "individual"},
    )
    assert claim_resp.status_code == 200

    release_resp = client.post("/jobs/release-overdue", headers=_headers(reviewer_id))
    assert release_resp.status_code == 200
    assert release_resp.json()["released_claims"] == 0

    claims_resp = client.get("/claims/mine", headers=_headers(employee_id), params={"status": "active"})
    assert claims_resp.status_code == 200
    assert any(item["task_id"] == task_id for item in claims_resp.json())

    app.dependency_overrides.clear()


def test_pagination_and_like_escape_for_lists(tmp_path: Path) -> None:
    client = _setup_client(tmp_path)

    reviewer_resp = client.post(
        "/users",
        headers=_headers(1),
        json={
            "name": "PagerReviewer",
            "employee_no": "R831",
            "department": "QA",
            "roles": ["reviewer", "acceptor", "employee"],
        },
    )
    assert reviewer_resp.status_code == 200
    reviewer_id = reviewer_resp.json()["id"]

    employee_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "PagerDev", "employee_no": "E831", "department": "RD", "roles": ["employee"]},
    )
    assert employee_resp.status_code == 200
    employee_id = employee_resp.json()["id"]

    created_problem_ids: list[int] = []
    created_task_ids: list[int] = []
    for idx in range(1, 3):
        problem_resp = client.post(
            "/problems",
            headers=_headers(employee_id),
            json={
                "title": f"pager problem {idx}",
                "scenario": "rd",
                "background": "pager",
                "frequency": "weekly",
                "impact_scope": "team",
                "description": "pager problem",
                "value_reduce_effort": True,
                "value_statement": "pager value",
            },
        )
        assert problem_resp.status_code == 200
        problem_id = problem_resp.json()["id"]
        created_problem_ids.append(problem_id)

        review_resp = client.post(
            f"/problems/{problem_id}/review",
            headers=_headers(reviewer_id),
            json={
                "approve": True,
                "task": {
                    "title": f"pager task {idx}",
                    "goal": "pager",
                    "scope": "single",
                    "due_date": (date.today() + timedelta(days=3)).isoformat(),
                    "level": "C",
                    "reward_total": 300,
                    "proposer_ratio": 0.2,
                    "accepter_id": reviewer_id,
                    "acceptance_criteria": [{"description": "ok", "type": "quantified"}],
                },
            },
        )
        assert review_resp.status_code == 200
        created_task_ids.append(review_resp.json()["id"])

    problems_page_1 = client.get(
        "/problems",
        headers=_headers(employee_id),
        params={"mine_only": "true", "limit": 1, "offset": 0},
    )
    assert problems_page_1.status_code == 200
    assert len(problems_page_1.json()) == 1

    problems_page_2 = client.get(
        "/problems",
        headers=_headers(employee_id),
        params={"mine_only": "true", "limit": 1, "offset": 1},
    )
    assert problems_page_2.status_code == 200
    assert len(problems_page_2.json()) == 1
    assert problems_page_1.json()[0]["id"] != problems_page_2.json()[0]["id"]

    tasks_page_1 = client.get("/tasks", headers=_headers(employee_id), params={"limit": 1, "offset": 0})
    assert tasks_page_1.status_code == 200
    assert len(tasks_page_1.json()) == 1
    tasks_page_2 = client.get("/tasks", headers=_headers(employee_id), params={"limit": 1, "offset": 1})
    assert tasks_page_2.status_code == 200
    assert len(tasks_page_2.json()) == 1
    assert tasks_page_1.json()[0]["id"] != tasks_page_2.json()[0]["id"]

    claim_resp = client.post(
        f"/tasks/{created_task_ids[0]}/claims",
        headers=_headers(employee_id),
        json={
            "mode": "team",
            "lead_user_id": employee_id,
            "members": [
                {"user_id": employee_id, "ratio": 0.3333},
                {"user_id": reviewer_id, "ratio": 0.3333},
                {"user_id": 1, "ratio": 0.3334},
            ],
        },
    )
    assert claim_resp.status_code == 200
    claim_id = claim_resp.json()["claim_id"]

    deliverable_resp = client.post(
        f"/claims/{claim_id}/deliverables",
        headers=_headers(employee_id),
        json={
            "summary": "pager deliverable",
            "criteria_results": ["ok"],
            "evidence_urls": [],
        },
    )
    assert deliverable_resp.status_code == 200
    deliverable_id = deliverable_resp.json()["deliverable_id"]

    accept_resp = client.post(
        f"/deliverables/{deliverable_id}/accept",
        headers=_headers(reviewer_id),
        json={"result": "approved", "comment": "ok"},
    )
    assert accept_resp.status_code == 200

    rewards_page = client.get("/rewards", headers=_headers(employee_id), params={"limit": 1, "offset": 0})
    assert rewards_page.status_code == 200
    assert len(rewards_page.json()) == 1

    all_rewards = client.get("/rewards", headers=_headers(employee_id))
    assert all_rewards.status_code == 200
    related_rewards = [item for item in all_rewards.json() if item["task_id"] == created_task_ids[0]]
    assert len(related_rewards) == 4
    assert round(sum(item["amount"] for item in related_rewards), 2) == 300.00

    escaped_keyword_resp = client.get("/knowledge", headers=_headers(employee_id), params={"keyword": "%"})
    assert escaped_keyword_resp.status_code == 200
    assert escaped_keyword_resp.json() == []

    app.dependency_overrides.clear()
