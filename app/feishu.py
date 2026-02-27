from __future__ import annotations

import json
import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Protocol
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx
from fastapi import HTTPException
from sqlalchemy import or_
from sqlmodel import Session, select

from app.enums import Role
from app.models import (
    Acceptance,
    Attachment,
    Claim,
    ClaimApprovalRequest,
    ClaimMember,
    Department,
    OAuthState,
    Problem,
    Reward,
    SystemConfig,
    Task,
    User,
    UserBadge,
    UserRole,
)
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

    def _get_app_access_token(self) -> str:
        """获取飞书 app_access_token（内部应用）"""
        with httpx.Client(timeout=10) as client:
            resp = client.post(
                "https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal",
                json={"app_id": self.app_id, "app_secret": self.app_secret},
            )
            resp.raise_for_status()
            data = resp.json()
            token = data.get("app_access_token") or data.get("tenant_access_token")
            if not token:
                raise HTTPException(status_code=502, detail="获取飞书 app_access_token 失败")
            return token

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

    @staticmethod
    def _as_text(value: object) -> str | None:
        if isinstance(value, str):
            text = value.strip()
            return text or None
        if isinstance(value, (int, float)):
            return str(value)
        return None

    @staticmethod
    def _normalize_avatar_url(value: object) -> str | None:
        if isinstance(value, str):
            text = value.strip()
            return text or None
        if isinstance(value, dict):
            for key in ("avatar_origin", "avatar_640", "avatar_240", "avatar_72"):
                raw = value.get(key)
                if isinstance(raw, str) and raw.strip():
                    return raw.strip()
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
        app_token = self._get_app_access_token()
        token_payload = {
            "grant_type": "authorization_code",
            "code": code,
        }
        with httpx.Client(timeout=10) as client:
            token_resp = client.post(
                self.token_url,
                json=token_payload,
                headers={"Authorization": f"Bearer {app_token}"},
            )
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

    def _list_from_endpoint(self, url: str, app_token: str | None = None) -> list[dict]:
        def _extract_rows(payload: object) -> tuple[list[dict], bool, str | None]:
            if isinstance(payload, list):
                return [row for row in payload if isinstance(row, dict)], False, None

            if not isinstance(payload, dict):
                return [], False, None

            data = payload.get("data")
            if isinstance(data, list):
                rows = [row for row in data if isinstance(row, dict)]
            elif isinstance(data, dict):
                rows = []
                for key in ("items", "users", "departments"):
                    value = data.get(key)
                    if isinstance(value, list):
                        rows = [row for row in value if isinstance(row, dict)]
                        break
            else:
                rows = []
                for key in ("items", "users", "departments"):
                    value = payload.get(key)
                    if isinstance(value, list):
                        rows = [row for row in value if isinstance(row, dict)]
                        break

            has_more = False
            page_token: str | None = None
            if isinstance(data, dict):
                has_more = bool(data.get("has_more"))
                token = data.get("page_token")
                if isinstance(token, str) and token.strip():
                    page_token = token.strip()
            else:
                has_more = bool(payload.get("has_more"))
                token = payload.get("page_token")
                if isinstance(token, str) and token.strip():
                    page_token = token.strip()

            return rows, has_more, page_token

        token = app_token or self._get_app_access_token()
        rows: list[dict] = []
        next_url = url
        max_pages = 200
        page_count = 0

        with httpx.Client(timeout=10) as client:
            while next_url and page_count < max_pages:
                resp = client.get(next_url, headers={"Authorization": f"Bearer {token}"})
                resp.raise_for_status()
                payload = resp.json()
                current_rows, has_more, page_token = _extract_rows(payload)
                rows.extend(current_rows)

                if not has_more:
                    break

                if not page_token:
                    break

                separator = "&" if "?" in url else "?"
                next_url = f"{url}{separator}page_token={page_token}"
                page_count += 1

        return rows

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

    @staticmethod
    def _collect_department_ids(row: dict) -> list[str]:
        values: list[str] = []

        def _push(raw: object) -> None:
            if raw is None:
                return
            if isinstance(raw, str):
                text = raw.strip()
                if text:
                    values.append(text)
                return
            if isinstance(raw, int):
                values.append(str(raw))
                return
            if isinstance(raw, list):
                for item in raw:
                    _push(item)

        _push(row.get("department_id"))
        _push(row.get("open_department_id"))
        _push(row.get("department_ids"))
        _push(row.get("open_department_ids"))
        _push(row.get("department_id_list"))
        _push(row.get("open_department_id_list"))

        seen: set[str] = set()
        ordered: list[str] = []
        for item in values:
            if item not in seen:
                seen.add(item)
                ordered.append(item)
        return ordered

    @staticmethod
    def _with_query_overrides(url: str, **overrides: str | None) -> str:
        parsed = urlsplit(url)
        query = dict(parse_qsl(parsed.query, keep_blank_values=True))
        for key, value in overrides.items():
            if value is None:
                query.pop(key, None)
            else:
                query[key] = value
        return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query), parsed.fragment))

    def _build_department_name_index(self, rows: list[dict] | None = None) -> dict[str, str]:
        if rows is None:
            rows = self._list_from_endpoint(self.departments_url)
        result: dict[str, str] = {}
        for row in rows:
            name = row.get("name") or row.get("department_name")
            if not isinstance(name, str):
                continue
            text = name.strip()
            if not text:
                continue
            for key in ("department_id", "open_department_id", "external_id", "id"):
                raw = row.get(key)
                if isinstance(raw, str) and raw.strip():
                    result[raw.strip()] = text
                elif isinstance(raw, int):
                    result[str(raw)] = text
        return result

    def _resolve_department_name(self, row: dict, dept_name_index: dict[str, str]) -> str | None:
        direct_name = row.get("department") or row.get("department_name")
        if isinstance(direct_name, str) and direct_name.strip():
            return direct_name.strip()
        for dept_id in self._collect_department_ids(row):
            mapped = dept_name_index.get(dept_id)
            if mapped:
                return mapped
        return None

    def list_users(self) -> list[dict]:
        app_token = self._get_app_access_token()
        rows = self._list_from_endpoint(self.users_url, app_token=app_token)
        department_rows = self._list_from_endpoint(self.departments_url, app_token=app_token)
        dept_name_index = self._build_department_name_index(department_rows)
        result_map: dict[str, dict] = {}

        query = dict(parse_qsl(urlsplit(self.users_url).query, keep_blank_values=True))
        users_endpoint_looks_department_scoped = (
            "find_by_department" in self.users_url or "department_id" in query
        )
        source_rows: list[dict] = list(rows)

        if users_endpoint_looks_department_scoped and department_rows:
            source_rows = []
            dept_id_type = query.get("department_id_type", "department_id")
            fetched_dept_ids: set[str] = set()
            for dept in department_rows:
                dept_id = self._as_text(dept.get(dept_id_type))
                if not dept_id:
                    dept_id = self._as_text(dept.get("department_id")) or self._as_text(
                        dept.get("open_department_id")
                    )
                if not dept_id or dept_id in fetched_dept_ids:
                    continue
                fetched_dept_ids.add(dept_id)
                dept_url = self._with_query_overrides(
                    self.users_url,
                    department_id=dept_id,
                    fetch_child="false",
                )
                source_rows.extend(self._list_from_endpoint(dept_url, app_token=app_token))

        for row in source_rows:
            source = row.get("user") if isinstance(row.get("user"), dict) else row
            if not isinstance(source, dict):
                continue

            external_id = self._as_text(source.get("external_id") or source.get("open_id") or source.get("user_id"))
            if not external_id:
                continue

            department_name = self._resolve_department_name(source, dept_name_index)
            candidate = {
                "external_id": external_id,
                "name": self._as_text(source.get("name") or source.get("en_name")) or "UNKNOWN",
                "email": self._as_text(source.get("email") or source.get("enterprise_email")),
                "employee_no": self._as_text(source.get("employee_no")),
                "department": department_name,
                "avatar_url": self._normalize_avatar_url(source.get("avatar_url") or source.get("avatar")),
            }
            current = result_map.get(external_id)
            if current is None:
                result_map[external_id] = candidate
                continue
            for key in ("name", "email", "employee_no", "department", "avatar_url"):
                if not current.get(key) and candidate.get(key):
                    current[key] = candidate[key]

        return list(result_map.values())


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


def _as_text(value: object) -> str | None:
    if isinstance(value, str):
        text = value.strip()
        return text or None
    if isinstance(value, (int, float)):
        return str(value)
    return None


def _is_empty_external_id_expr():
    return or_(User.external_id.is_(None), User.external_id == "")


def _find_unique_local_user_for_merge(
    session: Session,
    *,
    employee_no: str | None,
    email: str | None,
    name: str | None,
    exclude_user_id: int | None = None,
) -> User | None:
    def _query_one(field, value: str | None) -> User | None:
        if not value:
            return None
        stmt = select(User).where(_is_empty_external_id_expr(), field == value)
        if exclude_user_id is not None:
            stmt = stmt.where(User.id != exclude_user_id)
        rows = session.exec(stmt).all()
        if len(rows) == 1:
            return rows[0]
        return None

    by_employee = _query_one(User.employee_no, employee_no)
    if by_employee is not None:
        return by_employee
    by_email = _query_one(User.email, email)
    if by_email is not None:
        return by_email
    return _query_one(User.name, name)


def _user_has_business_refs(session: Session, user_id: int) -> bool:
    return any(
        session.exec(stmt).first() is not None
        for stmt in (
            select(Problem.id).where(Problem.submitter_id == user_id).limit(1),
            select(Problem.id).where(Problem.priced_accepter_id == user_id).limit(1),
            select(Problem.id).where(Problem.priced_by_user_id == user_id).limit(1),
            select(Problem.id).where(Problem.budget_reviewed_by_user_id == user_id).limit(1),
            select(Task.id).where(Task.accepter_id == user_id).limit(1),
            select(Claim.id).where(Claim.lead_user_id == user_id).limit(1),
            select(ClaimMember.claim_id).where(ClaimMember.user_id == user_id).limit(1),
            select(ClaimApprovalRequest.id).where(ClaimApprovalRequest.applicant_user_id == user_id).limit(1),
            select(ClaimApprovalRequest.id).where(ClaimApprovalRequest.reviewed_by_user_id == user_id).limit(1),
            select(Acceptance.id).where(Acceptance.accepter_id == user_id).limit(1),
            select(Reward.id).where(Reward.user_id == user_id).limit(1),
            select(UserBadge.id).where(UserBadge.user_id == user_id).limit(1),
            select(Attachment.id).where(Attachment.uploader_user_id == user_id).limit(1),
        )
    )


def _merge_user_roles(session: Session, source_user_id: int, target_user_id: int) -> None:
    source_roles = session.exec(select(UserRole).where(UserRole.user_id == source_user_id)).all()
    target_roles = {
        row.role for row in session.exec(select(UserRole).where(UserRole.user_id == target_user_id)).all()
    }
    for row in source_roles:
        if row.role not in target_roles:
            session.add(UserRole(user_id=target_user_id, role=row.role))
            target_roles.add(row.role)
        session.delete(row)


def _try_auto_merge_existing_duplicate(
    session: Session,
    *,
    synced_user: User,
    legacy_user: User,
    external_id: str,
    employee_no: str | None,
    name: str,
    department: str | None,
    email: str | None,
    avatar_url: str | None,
) -> User:
    if synced_user.id is None or legacy_user.id is None:
        return synced_user
    if synced_user.id == legacy_user.id:
        return synced_user

    synced_has_refs = _user_has_business_refs(session, synced_user.id)
    legacy_has_refs = _user_has_business_refs(session, legacy_user.id)

    if legacy_has_refs and not synced_has_refs:
        _merge_user_roles(session, source_user_id=synced_user.id, target_user_id=legacy_user.id)
        legacy_user.external_id = external_id
        legacy_user.employee_no = employee_no or legacy_user.employee_no
        legacy_user.name = name or legacy_user.name
        legacy_user.department = department or legacy_user.department
        legacy_user.email = email or legacy_user.email
        legacy_user.avatar_url = avatar_url or legacy_user.avatar_url
        session.delete(synced_user)
        return legacy_user

    if not legacy_has_refs and synced_has_refs:
        _merge_user_roles(session, source_user_id=legacy_user.id, target_user_id=synced_user.id)
        session.delete(legacy_user)
        return synced_user

    if not legacy_has_refs and not synced_has_refs:
        _merge_user_roles(session, source_user_id=synced_user.id, target_user_id=legacy_user.id)
        legacy_user.external_id = external_id
        legacy_user.employee_no = employee_no or legacy_user.employee_no
        legacy_user.name = name or legacy_user.name
        legacy_user.department = department or legacy_user.department
        legacy_user.email = email or legacy_user.email
        legacy_user.avatar_url = avatar_url or legacy_user.avatar_url
        session.delete(synced_user)
        return legacy_user

    return synced_user


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
        external_id = _as_text(row.get("external_id"))
        if not external_id:
            continue

        employee_no = _as_text(row.get("employee_no"))
        name = _as_text(row.get("name")) or "UNKNOWN"
        department = _as_text(row.get("department"))
        email = _as_text(row.get("email"))
        avatar_url = _as_text(row.get("avatar_url"))

        user = session.exec(select(User).where(User.external_id == external_id)).first()
        legacy_user = _find_unique_local_user_for_merge(
            session,
            employee_no=employee_no,
            email=email,
            name=name,
            exclude_user_id=user.id if user and user.id else None,
        )

        if user is None:
            if legacy_user is not None:
                user = legacy_user
                user.external_id = external_id
            else:
                user = User(
                    external_id=external_id,
                    employee_no=employee_no,
                    name=name,
                    department=department,
                    email=email,
                    avatar_url=avatar_url,
                )
                session.add(user)
                session.flush()
        elif legacy_user is not None:
            user = _try_auto_merge_existing_duplicate(
                session,
                synced_user=user,
                legacy_user=legacy_user,
                external_id=external_id,
                employee_no=employee_no,
                name=name,
                department=department,
                email=email,
                avatar_url=avatar_url,
            )

        user.employee_no = employee_no or user.employee_no
        user.name = name or user.name
        user.department = department or user.department
        user.email = email or user.email
        user.avatar_url = avatar_url or user.avatar_url

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
            value=json.dumps(DEFAULT_ACCEPTANCE_TEMPLATES.model_dump(), ensure_ascii=False),
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
            value=json.dumps(payload.model_dump(), ensure_ascii=False),
            updated_at=now,
        )
        session.add(row)
    else:
        row.value = json.dumps(payload.model_dump(), ensure_ascii=False)
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
