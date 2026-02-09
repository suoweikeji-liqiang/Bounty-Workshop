from __future__ import annotations

import json
import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Protocol
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException
from sqlmodel import Session, select

from app.enums import Role
from app.models import Department, OAuthState, SystemConfig, User, UserRole
from app.schemas import (
    AcceptanceTemplatesConfig,
    DepartmentRead,
    FeishuLoginResult,
    FeishuSyncResult,
)


SYNC_FREQUENCY_KEY = "feishu_sync_frequency_minutes"
DEFAULT_SYNC_FREQUENCY_MINUTES = 1440
ACCEPTANCE_TEMPLATES_KEY = "acceptance_templates"
DEFAULT_ACCEPTANCE_TEMPLATES = AcceptanceTemplatesConfig(
    approved=[
        "验收通过：已满足任务目标和验收标准。",
        "通过：结果可复现，证据完整。",
        "通过：符合范围与质量要求。",
    ],
    rework=[
        "需要整改：请补充关键证据后重新提交。",
        "需要整改：部分验收项说明不充分。",
        "需要整改：请对未达成项给出修复计划。",
    ],
    rejected=[
        "不通过：未达到核心验收标准。",
        "不通过：结果与任务范围不匹配。",
        "不通过：建议重新揭榜执行。",
    ],
)


class FeishuProvider(Protocol):
    provider_name: str

    def build_login_url(self, state: str) -> str:
        raise NotImplementedError

    def fetch_profile_by_code(self, code: str) -> dict:
        raise NotImplementedError

    def list_departments(self) -> list[dict]:
        raise NotImplementedError

    def list_users(self) -> list[dict]:
        raise NotImplementedError


@dataclass
class MockFeishuProvider:
    provider_name: str = "feishu-mock"

    def build_login_url(self, state: str) -> str:
        return f"https://mock.feishu.local/oauth?state={state}"

    def fetch_profile_by_code(self, code: str) -> dict:
        return {
            "external_id": f"ou_mock_{code}",
            "name": f"MockUser-{code}",
            "email": f"mock-{code}@example.com",
            "employee_no": f"M{code[-4:].upper():0>4}",
            "department": "MockDept",
            "avatar_url": "https://mock.example.com/avatar.png",
        }

    def list_departments(self) -> list[dict]:
        return [
            {"external_id": "dept_rd", "name": "R&D", "parent_external_id": None, "leader_external_user_id": None},
            {"external_id": "dept_qa", "name": "QA", "parent_external_id": None, "leader_external_user_id": None},
        ]

    def list_users(self) -> list[dict]:
        return [
            {
                "external_id": "ou_devrd_001",
                "name": "Dev One",
                "email": "dev.one@example.com",
                "employee_no": "RD001",
                "department": "R&D",
                "avatar_url": "",
            },
            {
                "external_id": "ou_qa_001",
                "name": "QA One",
                "email": "qa.one@example.com",
                "employee_no": "QA001",
                "department": "QA",
                "avatar_url": "",
            },
        ]


@dataclass
class HttpFeishuProvider:
    app_id: str
    app_secret: str
    authorize_url: str
    token_url: str
    profile_url: str
    departments_url: str
    users_url: str
    redirect_uri: str | None = None
    provider_name: str = "feishu-http"

    @staticmethod
    def _dig(data: dict, *keys: str):
        for key in keys:
            if isinstance(data, dict) and key in data:
                return data[key]
        if isinstance(data, dict):
            nested = data.get("data")
            if isinstance(nested, dict):
                for key in keys:
                    if key in nested:
                        return nested[key]
        return None

    def build_login_url(self, state: str) -> str:
        query = {
            "client_id": self.app_id,
            "state": state,
        }
        if self.redirect_uri:
            query["redirect_uri"] = self.redirect_uri
        return f"{self.authorize_url}?{urlencode(query)}"

    def fetch_profile_by_code(self, code: str) -> dict:
        token_payload = {
            "grant_type": "authorization_code",
            "code": code,
            "client_id": self.app_id,
            "client_secret": self.app_secret,
        }
        if self.redirect_uri:
            token_payload["redirect_uri"] = self.redirect_uri
        with httpx.Client(timeout=10) as client:
            token_resp = client.post(self.token_url, json=token_payload)
            token_resp.raise_for_status()
            token_data = token_resp.json()
            access_token = self._dig(token_data, "access_token", "user_access_token")
            if not access_token:
                raise HTTPException(status_code=502, detail="飞书令牌获取失败：未返回 access_token")
            profile_resp = client.get(
                self.profile_url,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            profile_resp.raise_for_status()
            raw = profile_resp.json()

        return {
            "external_id": self._dig(raw, "open_id", "user_id", "union_id"),
            "name": self._dig(raw, "name", "en_name") or "FeishuUser",
            "email": self._dig(raw, "email"),
            "employee_no": self._dig(raw, "employee_no"),
            "department": self._dig(raw, "department_name"),
            "avatar_url": self._dig(raw, "avatar_url", "avatar"),
        }

    def _list_from_endpoint(self, url: str) -> list[dict]:
        with httpx.Client(timeout=10) as client:
            resp = client.get(url, headers={"X-Feishu-App-Id": self.app_id, "X-Feishu-App-Secret": self.app_secret})
            resp.raise_for_status()
            payload = resp.json()
        if isinstance(payload, list):
            return payload
        if isinstance(payload, dict):
            for key in ["items", "data", "users", "departments"]:
                value = payload.get(key)
                if isinstance(value, list):
                    return value
        return []

    def list_departments(self) -> list[dict]:
        rows = self._list_from_endpoint(self.departments_url)
        return [
            {
                "external_id": row.get("external_id") or row.get("id") or row.get("department_id"),
                "name": row.get("name") or row.get("department_name") or "UNKNOWN",
                "parent_external_id": row.get("parent_external_id") or row.get("parent_id"),
                "leader_external_user_id": row.get("leader_external_user_id") or row.get("leader_user_id"),
            }
            for row in rows
            if row.get("external_id") or row.get("id") or row.get("department_id")
        ]

    def list_users(self) -> list[dict]:
        rows = self._list_from_endpoint(self.users_url)
        return [
            {
                "external_id": row.get("external_id") or row.get("open_id") or row.get("user_id"),
                "name": row.get("name") or "UNKNOWN",
                "email": row.get("email"),
                "employee_no": row.get("employee_no"),
                "department": row.get("department") or row.get("department_name"),
                "avatar_url": row.get("avatar_url") or row.get("avatar"),
            }
            for row in rows
            if row.get("external_id") or row.get("open_id") or row.get("user_id")
        ]


def get_feishu_provider() -> FeishuProvider:
    provider_mode = os.getenv("FEISHU_PROVIDER", "mock").strip().lower()
    if provider_mode == "mock":
        return MockFeishuProvider()
    app_id = os.getenv("FEISHU_APP_ID")
    app_secret = os.getenv("FEISHU_APP_SECRET")
    authorize_url = os.getenv("FEISHU_AUTHORIZE_URL")
    token_url = os.getenv("FEISHU_TOKEN_URL")
    profile_url = os.getenv("FEISHU_PROFILE_URL")
    departments_url = os.getenv("FEISHU_DEPARTMENTS_URL")
    users_url = os.getenv("FEISHU_USERS_URL")
    if not all([app_id, app_secret, authorize_url, token_url, profile_url, departments_url, users_url]):
        raise HTTPException(status_code=500, detail="飞书 HTTP 模式缺少必要环境变量")
    return HttpFeishuProvider(
        app_id=app_id,
        app_secret=app_secret,
        authorize_url=authorize_url,
        token_url=token_url,
        profile_url=profile_url,
        departments_url=departments_url,
        users_url=users_url,
        redirect_uri=os.getenv("FEISHU_REDIRECT_URI"),
    )


def _ensure_employee_role(session: Session, user_id: int) -> None:
    role = session.exec(select(UserRole).where(UserRole.user_id == user_id, UserRole.role == Role.EMPLOYEE)).first()
    if role is None:
        session.add(UserRole(user_id=user_id, role=Role.EMPLOYEE))


def create_oauth_state(session: Session, provider_name: str) -> OAuthState:
    state = secrets.token_urlsafe(24)
    record = OAuthState(
        provider=provider_name,
        state=state,
        expires_at=datetime.utcnow() + timedelta(minutes=10),
    )
    session.add(record)
    session.commit()
    session.refresh(record)
    return record


def consume_oauth_state(session: Session, provider_name: str, state: str) -> OAuthState:
    record = session.exec(
        select(OAuthState).where(OAuthState.provider == provider_name, OAuthState.state == state)
    ).first()
    if record is None:
        raise HTTPException(status_code=400, detail="无效的 state")
    if record.consumed_at is not None:
        raise HTTPException(status_code=400, detail="state 已被使用")
    if record.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="state 已过期")
    record.consumed_at = datetime.utcnow()
    session.commit()
    session.refresh(record)
    return record


def login_by_feishu_code(session: Session, profile: dict) -> FeishuLoginResult:
    external_id = profile.get("external_id")
    if not external_id:
        raise HTTPException(status_code=502, detail="飞书用户信息缺失 external_id")

    user = session.exec(select(User).where(User.external_id == external_id)).first()
    is_new_user = user is None
    if user is None:
        user = User(
            external_id=external_id,
            employee_no=profile.get("employee_no"),
            name=profile.get("name") or "FeishuUser",
            department=profile.get("department"),
            email=profile.get("email"),
            avatar_url=profile.get("avatar_url"),
        )
        session.add(user)
        session.flush()
    else:
        user.name = profile.get("name") or user.name
        user.department = profile.get("department") or user.department
        user.email = profile.get("email") or user.email
        user.avatar_url = profile.get("avatar_url") or user.avatar_url
        user.employee_no = profile.get("employee_no") or user.employee_no

    _ensure_employee_role(session, user.id)
    session.commit()
    session.refresh(user)
    return FeishuLoginResult(
        user_id=user.id,
        user_name=user.name,
        external_id=external_id,
        is_new_user=is_new_user,
    )


def sync_departments(session: Session, departments: list[dict]) -> int:
    synced = 0
    for row in departments:
        external_id = row.get("external_id")
        if not external_id:
            continue
        dept = session.exec(select(Department).where(Department.external_id == external_id)).first()
        if dept is None:
            dept = Department(
                external_id=external_id,
                name=row.get("name") or "UNKNOWN",
                parent_external_id=row.get("parent_external_id"),
                leader_external_user_id=row.get("leader_external_user_id"),
            )
            session.add(dept)
        else:
            dept.name = row.get("name") or dept.name
            dept.parent_external_id = row.get("parent_external_id")
            dept.leader_external_user_id = row.get("leader_external_user_id")
            dept.updated_at = datetime.utcnow()
        synced += 1
    session.commit()
    return synced


def sync_users(session: Session, users: list[dict]) -> int:
    synced = 0
    for row in users:
        external_id = row.get("external_id")
        if not external_id:
            continue
        user = session.exec(select(User).where(User.external_id == external_id)).first()
        if user is None:
            user = User(
                external_id=external_id,
                employee_no=row.get("employee_no"),
                name=row.get("name") or "UNKNOWN",
                department=row.get("department"),
                email=row.get("email"),
                avatar_url=row.get("avatar_url"),
            )
            session.add(user)
            session.flush()
        else:
            user.employee_no = row.get("employee_no") or user.employee_no
            user.name = row.get("name") or user.name
            user.department = row.get("department") or user.department
            user.email = row.get("email") or user.email
            user.avatar_url = row.get("avatar_url") or user.avatar_url
        _ensure_employee_role(session, user.id)
        synced += 1
    session.commit()
    return synced


def run_feishu_sync(session: Session, provider: FeishuProvider, mode: str) -> FeishuSyncResult:
    synced_departments = 0
    synced_users = 0
    if mode in {"all", "departments"}:
        synced_departments = sync_departments(session, provider.list_departments())
    if mode in {"all", "users"}:
        synced_users = sync_users(session, provider.list_users())
    return FeishuSyncResult(
        synced_departments=synced_departments,
        synced_users=synced_users,
        mode=mode,
    )


def get_sync_frequency_minutes(session: Session) -> int:
    row = session.get(SystemConfig, SYNC_FREQUENCY_KEY)
    if row is None:
        row = SystemConfig(key=SYNC_FREQUENCY_KEY, value=str(DEFAULT_SYNC_FREQUENCY_MINUTES))
        session.add(row)
        session.commit()
        return DEFAULT_SYNC_FREQUENCY_MINUTES
    try:
        return int(row.value)
    except ValueError:
        return DEFAULT_SYNC_FREQUENCY_MINUTES


def set_sync_frequency_minutes(session: Session, frequency_minutes: int) -> int:
    row = session.get(SystemConfig, SYNC_FREQUENCY_KEY)
    now = datetime.utcnow()
    if row is None:
        row = SystemConfig(key=SYNC_FREQUENCY_KEY, value=str(frequency_minutes), updated_at=now)
        session.add(row)
    else:
        row.value = str(frequency_minutes)
        row.updated_at = now
    session.commit()
    return frequency_minutes


def get_acceptance_templates(session: Session) -> AcceptanceTemplatesConfig:
    row = session.get(SystemConfig, ACCEPTANCE_TEMPLATES_KEY)
    if row is None:
        row = SystemConfig(
            key=ACCEPTANCE_TEMPLATES_KEY,
            value=DEFAULT_ACCEPTANCE_TEMPLATES.model_dump_json(ensure_ascii=False),
        )
        session.add(row)
        session.commit()
        return DEFAULT_ACCEPTANCE_TEMPLATES
    try:
        payload = json.loads(row.value)
        return AcceptanceTemplatesConfig.model_validate(payload)
    except Exception:
        return DEFAULT_ACCEPTANCE_TEMPLATES


def set_acceptance_templates(
    session: Session,
    payload: AcceptanceTemplatesConfig,
) -> AcceptanceTemplatesConfig:
    row = session.get(SystemConfig, ACCEPTANCE_TEMPLATES_KEY)
    now = datetime.utcnow()
    if row is None:
        row = SystemConfig(
            key=ACCEPTANCE_TEMPLATES_KEY,
            value=payload.model_dump_json(ensure_ascii=False),
            updated_at=now,
        )
        session.add(row)
    else:
        row.value = payload.model_dump_json(ensure_ascii=False)
        row.updated_at = now
    session.commit()
    return payload


def list_departments(session: Session) -> list[DepartmentRead]:
    rows = session.exec(select(Department).order_by(Department.name)).all()
    return [
        DepartmentRead(
            id=item.id,
            external_id=item.external_id,
            name=item.name,
            parent_external_id=item.parent_external_id,
            leader_external_user_id=item.leader_external_user_id,
            updated_at=item.updated_at,
        )
        for item in rows
    ]
