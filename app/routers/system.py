from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app.ai_models import (
    create_ai_model,
    decrypt_api_key,
    delete_ai_model,
    get_ai_model,
    list_ai_models,
    update_ai_model,
)
from app.auth import get_current_user_id, require_roles
from app.db import get_session
from app.enums import Role
from app.feishu import (
    get_acceptance_templates,
    get_feishu_provider,
    get_sync_frequency_minutes,
    list_departments as list_synced_departments,
    run_feishu_sync,
    set_acceptance_templates,
    set_sync_frequency_minutes,
)
from app.jobs import (
    get_release_overdue_frequency_minutes,
    set_release_overdue_frequency_minutes,
)
from app.reporting import (
    dashboard_distribution,
    dashboard_rankings,
    dashboard_trends,
    export_dashboard_excel,
    export_knowledge_excel,
    export_knowledge_pdf,
    export_rewards_excel,
    export_tasks_excel,
)
from app.schemas import (
    AcceptanceTemplatesConfig,
    AIModelCreate,
    AIModelRead,
    AIModelUpdate,
    ClaimApprovalThresholdConfig,
    DashboardDistribution,
    DashboardRankings,
    DashboardTrends,
    DepartmentRead,
    FeishuSyncResult,
    OperationLogRead,
    SyncFrequencyConfig,
    SystemConfigOverviewRead,
    TimeRange,
    TrendGranularity,
)
from app.services import (
    get_claim_approval_overdue_threshold,
    dashboard_overview,
    list_operation_logs,
    release_overdue_claims,
    set_claim_approval_overdue_threshold,
)

router = APIRouter(tags=["system"])


@router.get("/departments", response_model=list[DepartmentRead])
def get_departments(
    session: Session = Depends(get_session),
    _: int = Depends(require_roles(Role.ADMIN, Role.REVIEWER, Role.ACCEPTOR)),
) -> list[DepartmentRead]:
    return list_synced_departments(session)


@router.get("/dashboard/overview")
def get_dashboard_overview(
    session: Session = Depends(get_session),
    _: int = Depends(get_current_user_id),
) -> dict:
    return dashboard_overview(session).model_dump()


@router.get("/dashboard/rankings", response_model=DashboardRankings)
def get_dashboard_rankings(
    time_range: TimeRange = Query(default="this_month"),
    top_n: int = Query(default=10, ge=1, le=100),
    session: Session = Depends(get_session),
    _: int = Depends(get_current_user_id),
) -> DashboardRankings:
    return dashboard_rankings(session, time_range=time_range, top_n=top_n)


@router.get("/dashboard/trends", response_model=DashboardTrends)
def get_dashboard_trends(
    time_range: TimeRange = Query(default="this_month"),
    granularity: TrendGranularity = Query(default="month"),
    session: Session = Depends(get_session),
    _: int = Depends(get_current_user_id),
) -> DashboardTrends:
    return dashboard_trends(session, time_range=time_range, granularity=granularity)


@router.get("/dashboard/distribution", response_model=DashboardDistribution)
def get_dashboard_distribution(
    time_range: TimeRange = Query(default="all"),
    session: Session = Depends(get_session),
    _: int = Depends(get_current_user_id),
) -> DashboardDistribution:
    return dashboard_distribution(session, time_range=time_range)


@router.get(
    "/exports/dashboard.xlsx",
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER, Role.ACCEPTOR))],
)
def get_export_dashboard_xlsx(
    time_range: TimeRange = Query(default="this_month"),
    granularity: TrendGranularity = Query(default="month"),
    top_n: int = Query(default=10, ge=1, le=100),
    session: Session = Depends(get_session),
) -> StreamingResponse:
    payload = export_dashboard_excel(session, time_range=time_range, granularity=granularity, top_n=top_n)
    return StreamingResponse(
        iter([payload]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=dashboard_export.xlsx"},
    )


@router.get(
    "/exports/rewards.xlsx",
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER, Role.ACCEPTOR))],
)
def get_export_rewards_xlsx(session: Session = Depends(get_session)) -> StreamingResponse:
    payload = export_rewards_excel(session)
    return StreamingResponse(
        iter([payload]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=rewards_export.xlsx"},
    )


@router.get(
    "/exports/tasks.xlsx",
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER, Role.ACCEPTOR))],
)
def get_export_tasks_xlsx(session: Session = Depends(get_session)) -> StreamingResponse:
    payload = export_tasks_excel(session)
    return StreamingResponse(
        iter([payload]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=tasks_export.xlsx"},
    )


@router.get(
    "/exports/knowledge.xlsx",
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER, Role.ACCEPTOR))],
)
def get_export_knowledge_xlsx(session: Session = Depends(get_session)) -> StreamingResponse:
    payload = export_knowledge_excel(session)
    return StreamingResponse(
        iter([payload]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=knowledge_export.xlsx"},
    )


@router.get(
    "/exports/knowledge.pdf",
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER, Role.ACCEPTOR))],
)
def get_export_knowledge_pdf(session: Session = Depends(get_session)) -> StreamingResponse:
    payload = export_knowledge_pdf(session)
    return StreamingResponse(
        iter([payload]),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=knowledge_export.pdf"},
    )


@router.get(
    "/operations/logs",
    response_model=list[OperationLogRead],
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER))],
)
def get_operation_logs(
    action: str | None = Query(default=None),
    actor_user_id: int | None = Query(default=None),
    created_from: date | None = Query(default=None),
    created_to: date | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    session: Session = Depends(get_session),
) -> list[OperationLogRead]:
    return list_operation_logs(
        session=session,
        action=action,
        actor_user_id=actor_user_id,
        created_from=created_from,
        created_to=created_to,
        limit=limit,
    )


@router.get(
    "/system/config/overview",
    response_model=SystemConfigOverviewRead,
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER, Role.ACCEPTOR))],
)
def get_system_config_overview(session: Session = Depends(get_session)) -> SystemConfigOverviewRead:
    return SystemConfigOverviewRead(
        feishu_sync_frequency_minutes=get_sync_frequency_minutes(session),
        release_overdue_frequency_minutes=get_release_overdue_frequency_minutes(session),
        claim_approval_overdue_threshold=get_claim_approval_overdue_threshold(session),
        acceptance_templates=get_acceptance_templates(session),
    )


@router.get(
    "/system/config/feishu-sync-frequency",
    response_model=SyncFrequencyConfig,
    dependencies=[Depends(require_roles(Role.ADMIN))],
)
def get_feishu_sync_frequency(session: Session = Depends(get_session)) -> SyncFrequencyConfig:
    return SyncFrequencyConfig(frequency_minutes=get_sync_frequency_minutes(session))


@router.put(
    "/system/config/feishu-sync-frequency",
    response_model=SyncFrequencyConfig,
    dependencies=[Depends(require_roles(Role.ADMIN))],
)
def put_feishu_sync_frequency(
    payload: SyncFrequencyConfig,
    session: Session = Depends(get_session),
) -> SyncFrequencyConfig:
    value = set_sync_frequency_minutes(session, payload.frequency_minutes)
    return SyncFrequencyConfig(frequency_minutes=value)


@router.get(
    "/system/config/release-overdue-frequency",
    response_model=SyncFrequencyConfig,
    dependencies=[Depends(require_roles(Role.ADMIN))],
)
def get_release_overdue_frequency(session: Session = Depends(get_session)) -> SyncFrequencyConfig:
    return SyncFrequencyConfig(frequency_minutes=get_release_overdue_frequency_minutes(session))


@router.put(
    "/system/config/release-overdue-frequency",
    response_model=SyncFrequencyConfig,
    dependencies=[Depends(require_roles(Role.ADMIN))],
)
def put_release_overdue_frequency(
    payload: SyncFrequencyConfig,
    session: Session = Depends(get_session),
) -> SyncFrequencyConfig:
    value = set_release_overdue_frequency_minutes(session, payload.frequency_minutes)
    return SyncFrequencyConfig(frequency_minutes=value)


@router.get(
    "/system/config/claim-approval-overdue-threshold",
    response_model=ClaimApprovalThresholdConfig,
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER))],
)
def get_claim_approval_threshold(session: Session = Depends(get_session)) -> ClaimApprovalThresholdConfig:
    return ClaimApprovalThresholdConfig(threshold=get_claim_approval_overdue_threshold(session))


@router.put(
    "/system/config/claim-approval-overdue-threshold",
    response_model=ClaimApprovalThresholdConfig,
    dependencies=[Depends(require_roles(Role.ADMIN))],
)
def put_claim_approval_threshold(
    payload: ClaimApprovalThresholdConfig,
    session: Session = Depends(get_session),
) -> ClaimApprovalThresholdConfig:
    value = set_claim_approval_overdue_threshold(session, payload.threshold)
    return ClaimApprovalThresholdConfig(threshold=value)


@router.get(
    "/system/config/acceptance-templates",
    response_model=AcceptanceTemplatesConfig,
    dependencies=[Depends(require_roles(Role.ADMIN, Role.ACCEPTOR, Role.REVIEWER))],
)
def get_acceptance_template_config(session: Session = Depends(get_session)) -> AcceptanceTemplatesConfig:
    return get_acceptance_templates(session)


@router.put(
    "/system/config/acceptance-templates",
    response_model=AcceptanceTemplatesConfig,
    dependencies=[Depends(require_roles(Role.ADMIN))],
)
def put_acceptance_template_config(
    payload: AcceptanceTemplatesConfig,
    session: Session = Depends(get_session),
) -> AcceptanceTemplatesConfig:
    return set_acceptance_templates(session, payload)


@router.post(
    "/integrations/feishu/sync",
    response_model=FeishuSyncResult,
    dependencies=[Depends(require_roles(Role.ADMIN))],
)
def post_feishu_sync(
    mode: str = Query(default="all", pattern="^(all|users|departments)$"),
    session: Session = Depends(get_session),
    provider=Depends(get_feishu_provider),
) -> FeishuSyncResult:
    return run_feishu_sync(session, provider=provider, mode=mode)


@router.post(
    "/jobs/release-overdue",
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER))],
)
def post_release_overdue(
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> dict:
    return release_overdue_claims(session, actor_id=actor_id)


@router.get(
    "/ai/models",
    response_model=list[AIModelRead],
    dependencies=[Depends(require_roles(Role.ADMIN))],
)
def get_ai_models(session: Session = Depends(get_session)) -> list[AIModelRead]:
    return [
        AIModelRead(
            id=m.id, name=m.name, provider=m.provider, api_base_url=m.api_base_url,
            has_api_key=bool(m.api_key_encrypted), model=m.model, is_default=m.is_default,
            enabled=m.enabled, max_tokens=m.max_tokens, temperature=m.temperature,
            timeout=m.timeout, created_at=m.created_at, updated_at=m.updated_at,
        )
        for m in list_ai_models(session)
    ]


@router.post(
    "/ai/models",
    response_model=AIModelRead,
    dependencies=[Depends(require_roles(Role.ADMIN))],
)
def post_ai_model(
    payload: AIModelCreate,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> AIModelRead:
    m = create_ai_model(session, actor_id, payload)
    return AIModelRead(
        id=m.id, name=m.name, provider=m.provider, api_base_url=m.api_base_url,
        has_api_key=bool(m.api_key_encrypted), model=m.model, is_default=m.is_default,
        enabled=m.enabled, max_tokens=m.max_tokens, temperature=m.temperature,
        timeout=m.timeout, created_at=m.created_at, updated_at=m.updated_at,
    )


@router.get(
    "/ai/models/{model_id}",
    response_model=AIModelRead,
    dependencies=[Depends(require_roles(Role.ADMIN))],
)
def get_ai_model_detail(
    model_id: int,
    session: Session = Depends(get_session),
) -> AIModelRead:
    m = get_ai_model(session, model_id)
    if m is None:
        raise HTTPException(status_code=404, detail="Model not found")
    return AIModelRead(
        id=m.id, name=m.name, provider=m.provider, api_base_url=m.api_base_url,
        has_api_key=bool(m.api_key_encrypted), model=m.model, is_default=m.is_default,
        enabled=m.enabled, max_tokens=m.max_tokens, temperature=m.temperature,
        timeout=m.timeout, created_at=m.created_at, updated_at=m.updated_at,
    )


@router.put(
    "/ai/models/{model_id}",
    response_model=AIModelRead,
    dependencies=[Depends(require_roles(Role.ADMIN))],
)
def put_ai_model(
    model_id: int,
    payload: AIModelUpdate,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> AIModelRead:
    m = update_ai_model(session, actor_id, model_id, payload)
    return AIModelRead(
        id=m.id, name=m.name, provider=m.provider, api_base_url=m.api_base_url,
        has_api_key=bool(m.api_key_encrypted), model=m.model, is_default=m.is_default,
        enabled=m.enabled, max_tokens=m.max_tokens, temperature=m.temperature,
        timeout=m.timeout, created_at=m.created_at, updated_at=m.updated_at,
    )


@router.delete(
    "/ai/models/{model_id}",
    dependencies=[Depends(require_roles(Role.ADMIN))],
)
def delete_ai_model_route(
    model_id: int,
    session: Session = Depends(get_session),
) -> dict:
    delete_ai_model(session, model_id)
    return {"message": "Model deleted"}


@router.get(
    "/ai/models/{model_id}/api-key",
    response_model=dict,
    dependencies=[Depends(require_roles(Role.ADMIN))],
)
def get_ai_model_api_key(
    model_id: int,
    session: Session = Depends(get_session),
) -> dict:
    m = get_ai_model(session, model_id)
    if m is None:
        raise HTTPException(status_code=404, detail="Model not found")
    if not m.api_key_encrypted:
        raise HTTPException(status_code=404, detail="No API key configured")
    return {"api_key": decrypt_api_key(m.api_key_encrypted)}
