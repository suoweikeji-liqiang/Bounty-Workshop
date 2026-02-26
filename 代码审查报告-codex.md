# 代码审查报告-codex

审查时间：2026-02-25  
审查范围：后端 `app/*`、前端 `web/src/*`、部署配置 `Dockerfile`/`docker-compose.yml`/`web/nginx.conf`、测试 `tests/*`

## 审查结论
当前工程具备完整的业务主流程骨架，但在 **系统配置功能可用性、附件权限边界、默认安全配置、部署安全基线** 上存在高风险问题，建议先修复 P0 再推进上线。

## 验证结果
- 后端测试：`pytest -q` => **2 failed / 18 passed**
- 前端构建：`npm --prefix web run build` => **通过**

失败用例：
1. `tests/test_feishu.py::test_acceptance_template_config`
2. `tests/test_flow.py::test_system_config_overview_and_operation_logs`

---

## 主要问题（按严重级别）

### P0-1 系统配置接口运行时崩溃（功能/操作性）
- 位置：`app/feishu.py:412`, `app/feishu.py:433`, `app/feishu.py:438`
- 问题：`model_dump_json(ensure_ascii=False)` 在当前 Pydantic 版本不支持该参数，触发 `TypeError`。
- 影响：
  - `GET /system/config/acceptance-templates` 500
  - `PUT /system/config/acceptance-templates` 500
  - `GET /system/config/overview` 间接 500（依赖 acceptance templates）
- 证据：上述 2 个 pytest 失败。
- 建议：改为 `json.dumps(model.model_dump(), ensure_ascii=False)` 或使用兼容的序列化路径，补接口回归测试。

### P0-2 附件权限控制链路不完整，存在越权读取风险（权限）
- 位置：
  - `app/main.py:508-514` (`GET /attachments/{id}`)
  - `app/main.py:548-558` (`GET /attachments/{id}/presign`)
  - `app/main.py:525`（下载仅在绑定实体时才做权限检查）
  - `app/attachments.py:294-311`（绑定附件未校验归属）
- 问题：
  - 元数据接口未做实体级访问校验。
  - presign 接口未做实体级访问校验（S3 场景可直接拿下载链接）。
  - 未绑定附件下载路径缺少 uploader/admin/reviewer 约束。
  - 绑定附件时仅校验 ID 存在，不校验上传者是否当前提交人。
- 影响：可通过附件 ID 枚举/绑定绕过拿到他人附件信息或下载地址。
- 建议：统一复用 `ensure_attachment_access`；绑定时增加 uploader 校验与“已绑定不可被他人复绑”约束。

### P0-3 默认认证与初始凭据过弱（权限/安全）
- 位置：
  - `app/main.py:175`, `app/main.py:187-189`（默认 `admin/admin123` 且打印到日志）
  - `app/auth.py:42`（`AUTH_TOKEN_SECRET` 默认常量）
  - `app/auth.py:32`, `app/auth.py:38`（非 production 默认开启免密登录和 `X-User-Id` 鉴权）
- 问题：默认配置对误部署非常不友好，一旦未正确设置 `APP_ENV`/密钥，即存在低成本接管风险。
- 建议：
  - 启动时强制检查强随机密钥。
  - 移除硬编码初始密码，改为一次性引导流程。
  - 默认关闭 `AUTH_ENABLE_PASSWORDLESS_LOGIN` 与 `AUTH_ENABLE_HEADER_USER_ID`。

### P0-4 AI 密钥加密键被硬编码并写入 compose（权限/安全）
- 位置：`app/ai_models.py:16-17`, `docker-compose.yml:59`
- 问题：固定加密键使“数据库泄露后可批量还原 API Key”成为高概率事件。
- 建议：移除默认值，启动强制要求 `AI_ENCRYPTION_KEY`，并做密钥轮换策略。

---

### P1-1 分析能力的对象级权限缺失（权限/流程）
- 位置：
  - `app/main.py:1430-1479`（分析/假设接口允许 employee）
  - `app/services.py:1619-1625`（`get_problem_analysis` 仅按 problem_id 取数据，无 actor 校验）
- 问题：任意员工可按 problem_id 访问/触发并读取不属于自己的问题分析内容。
- 影响：跨团队信息泄露、AI 调用成本被滥用。
- 建议：沿用 `get_problem_detail` 的对象级权限规则（提交人/审核人/管理员）。

### P1-2 评审引用与分析记录之间缺少一致性校验（流程/功能）
- 位置：`app/services.py:533-541`, `app/services.py:1659-1683`
- 问题：
  - 评审通过时仅校验 `analysis_id` 存在，未校验 `analysis.problem_id == problem_id`。
  - 手工创建 analysis-ref 时也未校验分析记录归属。
- 影响：可能把 A 问题的分析错误挂到 B 问题，破坏审计链与决策可追溯性。
- 建议：两处都增加 problem 归属一致性检查。

### P1-3 前端附件下载交互与鉴权机制不兼容（操作性）
- 位置：
  - `web/src/components/AttachmentField.tsx:76`
  - `web/src/pages/AttachmentsPage.tsx:143`, `web/src/pages/AttachmentsPage.tsx:166`
- 问题：使用 `<a href>` 直连下载，不会自动携带 `Authorization` 头。
- 影响：Bearer 鉴权场景下下载经常 401，用户体验为“列表可见但无法下载”。
- 建议：改为 `fetch`/`requestRaw` + blob 下载，或统一走后端一次性签名 URL 接口并做权限校验。

### P1-4 docker-compose 默认公开对象存储桶（权限/操作性）
- 位置：`docker-compose.yml:32`（`mc policy set public`）
- 问题：桶默认 public 与权限最小化原则冲突。
- 影响：对象 key 泄露后可直接匿名访问。
- 建议：改为 private + 受控 presign；生产环境拆分公开资源桶与业务证据桶。

---

### P2-1 密码重置接口请求体与路径参数重复（功能一致性）
- 位置：`app/schemas.py:97`, `app/main.py:442-452`
- 问题：`SetPasswordRequest` 要求 `user_id`，但路由实际使用 path `user_id`，body 字段被忽略。
- 影响：API 契约混乱，易导致客户端误用。
- 建议：从 schema 移除 `user_id`，只保留 `new_password/force_change`。

### P2-2 后台分析任务异常被吞掉，排障困难（操作性）
- 位置：`app/main.py:719-721`
- 问题：后台触发分析 `except Exception: pass`。
- 影响：线上失败无日志证据，难定位数据不一致原因。
- 建议：至少记录结构化错误日志，必要时写操作日志表。

---

## 四个维度总结
- 功能：核心流程可跑通，但系统配置相关接口当前不可用（P0）。
- 流程：评审与分析引用链存在一致性缺口（P1）。
- 权限：附件与分析模块仍有对象级授权漏洞（P0/P1）。
- 操作性：前端下载链路与鉴权不匹配、部署默认值不安全（P1/P0）。

## 优先级建议
1. 先修 P0（配置接口崩溃、附件权限、默认密钥与默认密码）。
2. 再修 P1（分析对象授权、引用一致性、前端下载链路）。
3. 最后收敛 P2（接口契约清理、后台异常可观测性）。
