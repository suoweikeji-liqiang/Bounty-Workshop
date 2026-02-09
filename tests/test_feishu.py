from pathlib import Path

from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine

from app.db import get_session
from app.enums import Role
from app.feishu import get_feishu_provider
from app.main import app
from app.models import User, UserRole


class StubFeishuProvider:
    provider_name = "feishu-stub"

    def build_login_url(self, state: str) -> str:
        return f"https://stub.local/login?state={state}"

    def fetch_profile_by_code(self, code: str) -> dict:
        return {
            "external_id": f"ou_{code}",
            "name": f"stub-user-{code}",
            "email": f"{code}@example.com",
            "employee_no": f"S{code[-3:]}",
            "department": "R&D",
            "avatar_url": "",
        }

    def list_departments(self) -> list[dict]:
        return [
            {"external_id": "dept_rd", "name": "R&D", "parent_external_id": None, "leader_external_user_id": None},
            {"external_id": "dept_ops", "name": "OPS", "parent_external_id": None, "leader_external_user_id": None},
        ]

    def list_users(self) -> list[dict]:
        return [
            {
                "external_id": "ou_sync_001",
                "name": "sync-user-1",
                "email": "sync1@example.com",
                "employee_no": "SYNC001",
                "department": "R&D",
                "avatar_url": "",
            },
            {
                "external_id": "ou_sync_002",
                "name": "sync-user-2",
                "email": "sync2@example.com",
                "employee_no": "SYNC002",
                "department": "OPS",
                "avatar_url": "",
            },
        ]


def _headers(user_id: int) -> dict[str, str]:
    return {"X-User-Id": str(user_id)}


def _setup_client(tmp_path: Path) -> TestClient:
    db_file = tmp_path / "test-feishu.db"
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
    app.dependency_overrides[get_feishu_provider] = lambda: StubFeishuProvider()
    return TestClient(app)


def test_feishu_oauth_and_sync(tmp_path: Path) -> None:
    client = _setup_client(tmp_path)

    login_url_resp = client.get("/auth/feishu/login-url")
    assert login_url_resp.status_code == 200
    payload = login_url_resp.json()
    assert payload["provider"] == "feishu-stub"
    assert "state=" in payload["login_url"]

    callback_resp = client.get(
        "/auth/feishu/callback",
        params={"code": "abc123", "state": payload["state"]},
    )
    assert callback_resp.status_code == 200
    login_result = callback_resp.json()
    assert login_result["external_id"] == "ou_abc123"
    assert login_result["is_new_user"] is True

    callback_resp_again = client.get("/auth/feishu/callback", params={"code": "abc123"})
    assert callback_resp_again.status_code == 200
    assert callback_resp_again.json()["is_new_user"] is False

    sync_resp = client.post("/integrations/feishu/sync", headers=_headers(1), params={"mode": "all"})
    assert sync_resp.status_code == 200
    sync_result = sync_resp.json()
    assert sync_result["synced_departments"] == 2
    assert sync_result["synced_users"] == 2

    departments_resp = client.get("/departments", headers=_headers(1))
    assert departments_resp.status_code == 200
    assert len(departments_resp.json()) == 2

    freq_get = client.get("/system/config/feishu-sync-frequency", headers=_headers(1))
    assert freq_get.status_code == 200
    assert freq_get.json()["frequency_minutes"] >= 5

    freq_put = client.put(
        "/system/config/feishu-sync-frequency",
        headers=_headers(1),
        json={"frequency_minutes": 60},
    )
    assert freq_put.status_code == 200
    assert freq_put.json()["frequency_minutes"] == 60

    app.dependency_overrides.clear()


def test_acceptance_template_config(tmp_path: Path) -> None:
    client = _setup_client(tmp_path)

    get_resp = client.get("/system/config/acceptance-templates", headers=_headers(1))
    assert get_resp.status_code == 200
    defaults = get_resp.json()
    assert len(defaults["approved"]) >= 1
    assert len(defaults["rework"]) >= 1
    assert len(defaults["rejected"]) >= 1

    update_resp = client.put(
        "/system/config/acceptance-templates",
        headers=_headers(1),
        json={
            "approved": ["approved template A", "approved template B"],
            "rework": ["rework template A"],
            "rejected": ["rejected template A"],
        },
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["approved"][0] == "approved template A"

    verify_resp = client.get("/system/config/acceptance-templates", headers=_headers(1))
    assert verify_resp.status_code == 200
    assert verify_resp.json()["approved"] == ["approved template A", "approved template B"]

    employee_resp = client.post(
        "/users",
        headers=_headers(1),
        json={
            "name": "EmployeeOnly",
            "employee_no": "E900",
            "department": "RD",
            "roles": ["employee"],
        },
    )
    assert employee_resp.status_code == 200
    employee_id = employee_resp.json()["id"]

    deny_get = client.get("/system/config/acceptance-templates", headers=_headers(employee_id))
    assert deny_get.status_code == 403

    deny_put = client.put(
        "/system/config/acceptance-templates",
        headers=_headers(employee_id),
        json={
            "approved": ["x"],
            "rework": ["y"],
            "rejected": ["z"],
        },
    )
    assert deny_put.status_code == 403

    app.dependency_overrides.clear()
