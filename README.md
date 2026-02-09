# 揭榜挂帅任务管理系统（MVP 后端）

基于 `软件需求规格说明书.md` 实现的可运行后端，当前覆盖：

- 主流程：问题提交 -> 审核立项 -> 揭榜 -> 成果提交 -> 验收 -> 激励生成/确认 -> 知识归档
- 附件对象存储：`local` 与 `s3/minio` 后端，支持预签名下载
- 飞书集成（MVP）：OAuth 登录回调、手动同步部门与人员、同步频率配置
- 定时作业：后台定时执行超期释放与飞书同步（均支持频率配置）
- 看板：总览、排行榜、趋势、分布
- 导出：任务/激励/知识/看板导出（Excel），知识导出（PDF）

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
  - `POST /claims/{claim_id}/deliverables`
  - `GET /deliverables/pending-acceptance/mine`
  - `POST /deliverables/{deliverable_id}/accept`
- 激励与知识
  - `GET /rewards`
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

## 测试

```bash
pytest -q
```

当前结果：`9 passed`

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
