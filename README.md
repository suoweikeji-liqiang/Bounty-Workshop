# 揭榜挂帅任务管理系统（MVP 后端）

基于 `软件需求规格说明书.md` 实现的可运行后端，当前覆盖：

- 主流程：问题提交 -> 审核立项 -> 揭榜 -> 成果提交 -> 验收 -> 激励生成/确认 -> 知识归档
- 附件对象存储：`local` 与 `s3/minio` 后端，支持预签名下载
- 飞书集成（MVP）：OAuth 登录回调、手动同步部门与人员、同步频率配置
- 定时作业：后台定时执行超期释放与飞书同步（均支持频率配置）
- 看板：总览、排行榜、趋势、分布
- 导出：任务/激励/知识/看板导出（Excel），知识导出（PDF）
- 终评联动：基础履责终评快照、看板分布扩展、导出附带终评字段、激励发放策略联动

## 技术栈

- Python 3.11
- FastAPI
- SQLModel + SQLite
- OpenPyXL
- ReportLab
- Pytest

## 快速启动

```bash
python -m pip install -e .[dev]
uvicorn app.main:app --reload
```

默认数据库文件：`data/app.db`
默认附件存储目录：`data/storage`

可通过环境变量修改数据库与附件目录：

```bash
APP_DB_PATH=./data/app.db
ATTACHMENT_STORAGE_DIR=./data/storage
ENABLE_BACKGROUND_JOBS=true
ENABLE_FEISHU_SYNC_JOB=true
```

对象存储后端切换（S3/MinIO）：

```bash
ATTACHMENT_STORAGE_BACKEND=s3
ATTACHMENT_S3_BUCKET=your-bucket
ATTACHMENT_S3_ENDPOINT_URL=http://127.0.0.1:9000   # MinIO 可填
ATTACHMENT_S3_REGION=us-east-1
ATTACHMENT_S3_ACCESS_KEY_ID=xxx
ATTACHMENT_S3_SECRET_ACCESS_KEY=yyy
ATTACHMENT_OBJECT_PREFIX=attachments
```

系统首次启动会自动创建管理员：

- `id=1`
- 角色：`admin/reviewer/acceptor/employee`

调用接口时需携带请求头：`X-User-Id`

## 前端（已启动开发）

前端工程目录：`web`

```bash
cd web
npm install
npm run dev
```

默认前端地址：`http://127.0.0.1:5173`
后端地址通过 `web/.env` 配置：`VITE_API_BASE_URL`

## 核心接口

- 用户与角色
  - `GET /me`
  - `GET /users/{user_id}`
  - `GET /users/active`
  - `GET /users`
  - `POST /users`
  - `PUT /users/{user_id}/roles`
- 附件对象存储
  - `POST /attachments/upload`（multipart）
  - `GET /attachments/{attachment_id}`
  - `GET /attachments/{attachment_id}/download`
  - `GET /attachments/{attachment_id}/presign`（仅 s3）
  - `GET /entities/{entity_type}/{entity_id}/attachments`
- 飞书集成
  - `GET /auth/feishu/login-url`
  - `GET /auth/feishu/callback`
  - `POST /integrations/feishu/sync`
  - `GET /departments`
  - `GET /system/config/feishu-sync-frequency`
  - `PUT /system/config/feishu-sync-frequency`
  - `GET /system/config/release-overdue-frequency`
  - `PUT /system/config/release-overdue-frequency`
- 问题与任务
  - `POST /problems`
  - `GET /problems`（支持 `mine_only/status/scenario/created_from/created_to`）
  - `POST /problems/{problem_id}/review`
  - `GET /tasks`（支持 `status/level/scenario/reward_min/reward_max`）
  - `GET /tasks/{task_id}`
  - `POST /tasks/{task_id}/claims`
  - `GET /claims/mine`
  - `GET /claims/{claim_id}/detail`
  - `GET /claims/{claim_id}/performance-review`
  - `PUT /claims/{claim_id}/performance-review`
  - `POST /claims/{claim_id}/deliverables`
  - `GET /deliverables/pending-acceptance/mine`
  - `POST /deliverables/{deliverable_id}/accept`
- 激励与知识
  - `GET /rewards`（支持 `user_id/status/held_only`）
  - `POST /rewards/{reward_id}/confirm`
  - `GET /knowledge`（支持 `keyword/scenario/level/recommended` 筛选）
  - `GET /knowledge/{knowledge_id}`
- 看板
  - `GET /dashboard/overview`
  - `GET /dashboard/rankings`
  - `GET /dashboard/trends`
  - `GET /dashboard/distribution`
- 导出
  - `GET /exports/tasks.xlsx`
  - `GET /exports/rewards.xlsx`
  - `GET /exports/knowledge.xlsx`
  - `GET /exports/knowledge.pdf`
  - `GET /exports/dashboard.xlsx`
- 作业与健康
  - `POST /jobs/release-overdue`
  - `GET /health`

终评联动说明：

- 若终评 `final_r_level` 为 `R1/R2`，执行人（`executor`）激励默认进入复核冻结。
- `reviewer` 无法确认冻结激励；`admin` 可执行复核确认。
- 看板新增终评相关指标：终评快照数、失职快照数、激励冻结数；分布新增基础履责分布与终评 R 分布。
- 前端新增“激励复核”页面，用于查看冻结激励并执行复核确认。

## 测试

```bash
pytest -q
```

当前结果：`13 passed`

前端端到端回归（Playwright）：

```bash
cd web
npm run e2e
```

## Latest Additions (2026-02-09)

- Personal center API:
  - `GET /me/summary`: returns user profile + reward stats + badges + personal reward history.
- Claim approval policy API:
  - `GET /system/config/claim-approval-overdue-threshold` (`admin/reviewer`)
  - `PUT /system/config/claim-approval-overdue-threshold` (`admin`)
- Claim strategy rule:
  - When `user.overdue_count >= threshold`, the user cannot self-claim tasks.
  - `admin/reviewer` can approve by claiming on behalf (`lead_user_id`).

## Latest Additions (2026-02-09, Sprint Next)

- Authentication/session:
  - `POST /auth/login` (returns Bearer access token)
  - `GET /me` and all protected APIs now support `Authorization: Bearer <token>`
  - Legacy `X-User-Id` is still backward-compatible for tests/internal scripts.
  - `GET /auth/feishu/callback` now also returns token fields.

- Overdue claim approval workbench:
  - `GET /claims/overdue-approvals/mine`
  - `GET /claims/overdue-approvals/pending`
  - `POST /claims/overdue-approvals/{request_id}/approve`
  - `POST /claims/overdue-approvals/{request_id}/reject`
  - When self-claim is blocked by overdue threshold, system auto-creates a pending approval request.

- Config center:
  - `GET /system/config/overview` (aggregated config snapshot)
  - Frontend page: centralized management for frequencies, threshold, acceptance templates.

- Audit logs:
  - `GET /operations/logs` with filters (`action`, `actor_user_id`, `created_from`, `created_to`, `limit`)
  - Frontend operation log page for admin/reviewer.

## Optimization Update (2026-02-09)

- P0: Rate limiting (key write APIs)
  - `POST /tasks/{task_id}/claims`: 30 req / 60s per client key
  - `POST /claims/{claim_id}/deliverables`: 20 req / 60s per client key
  - Config switch: `RATE_LIMIT_ENABLED=true|false`
  - Optional per-bucket override:
    - `RATE_LIMIT_TASK_CLAIM_LIMIT`, `RATE_LIMIT_TASK_CLAIM_WINDOW_SECONDS`
    - `RATE_LIMIT_DELIVERABLE_SUBMIT_LIMIT`, `RATE_LIMIT_DELIVERABLE_SUBMIT_WINDOW_SECONDS`

- P1: Knowledge query performance + pagination
  - `/knowledge` now supports SQL-level filtering and pagination params:
    - `keyword`, `scenario`, `level`, `recommended`, `offset`, `limit`
  - Frontend knowledge page now uses server-side pagination (`20/page`).

- P1: Task hall claim improvements
  - Claim setup can now choose tasks from both `open` and `in_progress` pools.
  - Deliverable `criteria_results` are now loaded dynamically from claim detail acceptance criteria.

- P2 (partial quick win)
  - Added `Esc` close behavior for task detail and knowledge detail modals.

## Latest Additions (2026-02-11)

- Problem resubmission after rejection:
  - `GET /problems/{problem_id}` to read full problem detail.
  - `PUT /problems/{problem_id}/resubmit` to modify a rejected problem and return it to `pending_review`.
  - Only the original submitter can resubmit.
- Claim concurrency guard:
  - A lead user can have at most 2 active claims at the same time.
  - Third active claim returns `400` with a clear error message.

## Latest Additions (2026-03-02)

- Unified task activity timeline:
  - Task-level timeline APIs:
    - `GET /tasks/{task_id}/activities`
    - `POST /tasks/{task_id}/activities`
    - `DELETE /activities/{activity_id}`
  - Claim-level timeline API:
    - `GET /claims/{claim_id}/activities`
  - Supports `comment`, `progress_update`, `blocker`, `official_note`, and system events.

- Complex task milestones:
  - Task definition supports:
    - `is_complex`
    - `closing_reward_ratio`
    - `milestones` (2-5, sequential, ratio validation)
  - Milestone execution APIs:
    - `GET /tasks/{task_id}/milestones`
    - `POST /tasks/{task_id}/milestones`
    - `PUT /milestones/{milestone_id}`
    - `POST /milestones/{milestone_id}/submit`
    - `POST /milestones/{milestone_id}/accept`
    - `GET /milestones/pending-acceptance/mine`

- Staged incentive release for complex tasks:
  - Milestone approval generates held incentive records.
  - Final deliverable approval releases earned milestone holds and settles final rewards.

- Stale progress reminder hook:
  - Background job detects active claims with no recent `progress_update`.
  - System writes a reminder activity event (`event_key=stale_progress_reminder`) and triggers Feishu notification hook.
  - Manual trigger endpoint:
    - `POST /jobs/stale-progress-reminders`
