import os
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine

from app.db import get_session
from app.enums import Role
from app.main import app
from app.models import (
    AIModel,
    Acceptance,
    Attachment,
    Claim,
    ClaimApprovalRequest,
    ClaimMember,
    Department,
    Deliverable,
    HypothesisVerification,
    Knowledge,
    OAuthState,
    OperationLog,
    Problem,
    ProblemAnalysis,
    ProblemReviewAnalysisRef,
    Reward,
    SystemConfig,
    Task,
    User,
    UserRole,
)


def _headers(user_id: int) -> dict[str, str]:
    return {"X-User-Id": str(user_id)}


def _setup_client(tmp_path: Path) -> TestClient:
    db_file = tmp_path / "test-attachments.db"
    engine = create_engine(f"sqlite:///{db_file}", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)
    os.environ["ATTACHMENT_STORAGE_BACKEND"] = "local"
    os.environ["ATTACHMENT_STORAGE_DIR"] = str(tmp_path / "storage")

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


def test_attachment_upload_bind_and_download(tmp_path: Path) -> None:
    client = _setup_client(tmp_path)

    reviewer_resp = client.post(
        "/users",
        headers=_headers(1),
        json={
            "name": "ReviewerA",
            "employee_no": "R101",
            "department": "QA",
            "roles": ["reviewer", "acceptor", "employee"],
        },
    )
    assert reviewer_resp.status_code == 200
    reviewer_id = reviewer_resp.json()["id"]

    employee_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "WorkerA", "employee_no": "E101", "department": "RD", "roles": ["employee"]},
    )
    assert employee_resp.status_code == 200
    employee_id = employee_resp.json()["id"]

    upload_problem_attachment = client.post(
        "/attachments/upload",
        headers=_headers(employee_id),
        files={"file": ("problem.txt", b"problem-attachment", "text/plain")},
    )
    assert upload_problem_attachment.status_code == 200
    attachment_1 = upload_problem_attachment.json()
    attachment_id_1 = attachment_1["id"]

    download_1 = client.get(f"/attachments/{attachment_id_1}/download", headers=_headers(employee_id))
    assert download_1.status_code == 200
    assert download_1.content == b"problem-attachment"

    problem_resp = client.post(
        "/problems",
        headers=_headers(employee_id),
        json={
            "title": "attachment problem",
            "scenario": "rd",
            "background": "need evidence",
            "frequency": "weekly",
            "impact_scope": "team",
            "description": "problem with attachment",
            "value_reduce_effort": True,
            "value_statement": "save time",
            "attachment_ids": [attachment_id_1],
        },
    )
    assert problem_resp.status_code == 200
    problem_id = problem_resp.json()["id"]

    task_resp = client.post(
        f"/problems/{problem_id}/review",
        headers=_headers(reviewer_id),
        json={
            "approve": True,
            "task": {
                "title": "task with evidence",
                "goal": "finish with files",
                "scope": "submit deliverable attachment",
                "due_date": (date.today() + timedelta(days=5)).isoformat(),
                "level": "C",
                "reward_total": 300,
                "proposer_ratio": 0.2,
                "accepter_id": reviewer_id,
                "acceptance_criteria": [{"description": "file exists", "type": "quantified"}],
            },
        },
    )
    assert task_resp.status_code == 200
    task_id = task_resp.json()["id"]

    claim_resp = client.post(
        f"/tasks/{task_id}/claims",
        headers=_headers(employee_id),
        json={"mode": "individual"},
    )
    assert claim_resp.status_code == 200
    claim_id = claim_resp.json()["claim_id"]

    upload_deliverable_attachment = client.post(
        "/attachments/upload",
        headers=_headers(employee_id),
        files={"file": ("deliverable.txt", b"deliverable-attachment", "text/plain")},
    )
    assert upload_deliverable_attachment.status_code == 200
    attachment_id_2 = upload_deliverable_attachment.json()["id"]

    my_attachments_resp = client.get(
        "/attachments/mine/list",
        headers=_headers(employee_id),
        params={"limit": 50},
    )
    assert my_attachments_resp.status_code == 200
    my_attachment_ids = {item["id"] for item in my_attachments_resp.json()}
    assert attachment_id_1 in my_attachment_ids
    assert attachment_id_2 in my_attachment_ids

    deliverable_resp = client.post(
        f"/claims/{claim_id}/deliverables",
        headers=_headers(employee_id),
        json={
            "summary": "done with attachment",
            "criteria_results": ["ok"],
            "evidence_attachment_ids": [attachment_id_2],
        },
    )
    assert deliverable_resp.status_code == 200
    deliverable_id = deliverable_resp.json()["deliverable_id"]

    problem_attachment_list = client.get(
        f"/entities/problem/{problem_id}/attachments",
        headers=_headers(employee_id),
    )
    assert problem_attachment_list.status_code == 200
    assert len(problem_attachment_list.json()) == 1

    deliverable_attachment_list = client.get(
        f"/entities/deliverable/{deliverable_id}/attachments",
        headers=_headers(employee_id),
    )
    assert deliverable_attachment_list.status_code == 200
    assert len(deliverable_attachment_list.json()) == 1

    app.dependency_overrides.clear()
    os.environ.pop("ATTACHMENT_STORAGE_BACKEND", None)
    os.environ.pop("ATTACHMENT_STORAGE_DIR", None)


def test_attachment_access_control_by_entity(tmp_path: Path) -> None:
    client = _setup_client(tmp_path)

    reviewer_resp = client.post(
        "/users",
        headers=_headers(1),
        json={
            "name": "ReviewerACL",
            "employee_no": "R301",
            "department": "QA",
            "roles": ["reviewer", "acceptor", "employee"],
        },
    )
    assert reviewer_resp.status_code == 200
    reviewer_id = reviewer_resp.json()["id"]

    owner_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "Owner", "employee_no": "E301", "department": "RD", "roles": ["employee"]},
    )
    assert owner_resp.status_code == 200
    owner_id = owner_resp.json()["id"]

    outsider_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "Outsider", "employee_no": "E302", "department": "RD", "roles": ["employee"]},
    )
    assert outsider_resp.status_code == 200
    outsider_id = outsider_resp.json()["id"]

    upload_problem_attachment = client.post(
        "/attachments/upload",
        headers=_headers(owner_id),
        files={"file": ("problem-acl.txt", b"acl-problem", "text/plain")},
    )
    assert upload_problem_attachment.status_code == 200
    problem_attachment_id = upload_problem_attachment.json()["id"]

    problem_resp = client.post(
        "/problems",
        headers=_headers(owner_id),
        json={
            "title": "acl problem",
            "scenario": "rd",
            "background": "acl background",
            "frequency": "weekly",
            "impact_scope": "team",
            "description": "acl description",
            "value_reduce_effort": True,
            "value_statement": "acl value",
            "attachment_ids": [problem_attachment_id],
        },
    )
    assert problem_resp.status_code == 200
    problem_id = problem_resp.json()["id"]

    blocked_problem_download = client.get(
        f"/attachments/{problem_attachment_id}/download",
        headers=_headers(outsider_id),
    )
    assert blocked_problem_download.status_code == 403

    blocked_problem_list = client.get(
        f"/entities/problem/{problem_id}/attachments",
        headers=_headers(outsider_id),
    )
    assert blocked_problem_list.status_code == 403

    reviewer_problem_download = client.get(
        f"/attachments/{problem_attachment_id}/download",
        headers=_headers(reviewer_id),
    )
    assert reviewer_problem_download.status_code == 200
    assert reviewer_problem_download.content == b"acl-problem"

    task_resp = client.post(
        f"/problems/{problem_id}/review",
        headers=_headers(reviewer_id),
        json={
            "approve": True,
            "task": {
                "title": "acl task",
                "goal": "acl goal",
                "scope": "acl scope",
                "due_date": (date.today() + timedelta(days=3)).isoformat(),
                "level": "C",
                "reward_total": 300,
                "proposer_ratio": 0.2,
                "accepter_id": reviewer_id,
                "acceptance_criteria": [{"description": "acl check", "type": "quantified"}],
            },
        },
    )
    assert task_resp.status_code == 200
    task_id = task_resp.json()["id"]

    claim_resp = client.post(
        f"/tasks/{task_id}/claims",
        headers=_headers(owner_id),
        json={"mode": "individual"},
    )
    assert claim_resp.status_code == 200
    claim_id = claim_resp.json()["claim_id"]

    upload_deliverable_attachment = client.post(
        "/attachments/upload",
        headers=_headers(owner_id),
        files={"file": ("deliverable-acl.txt", b"acl-deliverable", "text/plain")},
    )
    assert upload_deliverable_attachment.status_code == 200
    deliverable_attachment_id = upload_deliverable_attachment.json()["id"]

    deliverable_resp = client.post(
        f"/claims/{claim_id}/deliverables",
        headers=_headers(owner_id),
        json={
            "summary": "acl deliverable",
            "criteria_results": ["ok"],
            "evidence_attachment_ids": [deliverable_attachment_id],
        },
    )
    assert deliverable_resp.status_code == 200
    deliverable_id = deliverable_resp.json()["deliverable_id"]

    blocked_deliverable_download = client.get(
        f"/attachments/{deliverable_attachment_id}/download",
        headers=_headers(outsider_id),
    )
    assert blocked_deliverable_download.status_code == 403

    blocked_deliverable_list = client.get(
        f"/entities/deliverable/{deliverable_id}/attachments",
        headers=_headers(outsider_id),
    )
    assert blocked_deliverable_list.status_code == 403

    reviewer_deliverable_download = client.get(
        f"/attachments/{deliverable_attachment_id}/download",
        headers=_headers(reviewer_id),
    )
    assert reviewer_deliverable_download.status_code == 200
    assert reviewer_deliverable_download.content == b"acl-deliverable"

    app.dependency_overrides.clear()
    os.environ.pop("ATTACHMENT_STORAGE_BACKEND", None)
    os.environ.pop("ATTACHMENT_STORAGE_DIR", None)


def test_attachment_s3_presign_flow(tmp_path: Path) -> None:
    client = _setup_client(tmp_path)

    employee_resp = client.post(
        "/users",
        headers=_headers(1),
        json={"name": "WorkerS3", "employee_no": "E201", "department": "RD", "roles": ["employee"]},
    )
    assert employee_resp.status_code == 200
    employee_id = employee_resp.json()["id"]

    class FakeS3Client:
        def put_object(self, **kwargs):
            assert kwargs["Bucket"] == "bucket-test"
            assert kwargs["Key"].startswith("attachments/")
            assert kwargs["Body"] == b"s3-attachment"

        def generate_presigned_url(self, _operation, Params, ExpiresIn):
            return f"https://minio.local/{Params['Bucket']}/{Params['Key']}?exp={ExpiresIn}"

    os.environ["ATTACHMENT_STORAGE_BACKEND"] = "s3"
    os.environ["ATTACHMENT_S3_BUCKET"] = "bucket-test"
    with patch("app.attachments._create_s3_client", return_value=FakeS3Client()):
        upload_resp = client.post(
            "/attachments/upload",
            headers=_headers(employee_id),
            files={"file": ("s3.txt", b"s3-attachment", "text/plain")},
        )
        assert upload_resp.status_code == 200
        attachment = upload_resp.json()
        attachment_id = attachment["id"]
        assert attachment["storage_backend"] == "s3"
        assert attachment["bucket"] == "bucket-test"

        presign_resp = client.get(
            f"/attachments/{attachment_id}/presign",
            headers=_headers(employee_id),
            params={"expires_in": 600},
        )
        assert presign_resp.status_code == 200
        assert "https://minio.local/" in presign_resp.json()["url"]

        download_resp = client.get(
            f"/attachments/{attachment_id}/download",
            headers=_headers(employee_id),
            follow_redirects=False,
        )
        assert download_resp.status_code == 307
        assert "https://minio.local/" in download_resp.headers["location"]

    app.dependency_overrides.clear()
    os.environ.pop("ATTACHMENT_STORAGE_BACKEND", None)
    os.environ.pop("ATTACHMENT_S3_BUCKET", None)
    os.environ.pop("ATTACHMENT_STORAGE_DIR", None)
