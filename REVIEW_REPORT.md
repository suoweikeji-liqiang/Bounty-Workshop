# 揭榜挂帅系统 — 功能与流程审核报告

> 审核日期：2026-02-26
> 审核范围：全流程功能完整性、状态机流转、前后端一致性、权限控制、边界场景

---

## 一、总体评价

系统整体架构清晰，核心业务流程（问题提报 → 审核 → 揭榜 → 交付 → 验收 → 奖励）基本完整。以下按严重程度分级列出发现的问题。

---

## 二、🔴 严重问题（流程断裂/功能缺失）

### 2.1 OVERDUE 揭榜状态死锁

**位置**: `app/services_claims.py:677`

揭榜被标记为 `OVERDUE` 后，没有任何状态转移路径。既不能恢复为 `ACTIVE`，也不能转为 `ABANDONED`。一旦进入该状态，揭榜记录永久卡死，关联任务被重置为 `OPEN` 但原揭榜无法清理。

同时 `User.overdue_count` 只增不减，用户一旦累积逾期次数，永远无法恢复，持续触发揭榜审批门槛。

### 2.2 奖励审核页面未接入路由

**位置**: `web/src/pages/RewardReviewPage.tsx`

`RewardReviewPage` 组件已完整实现（列表、筛选、确认操作），但未在 `App.tsx` 中注册路由，也未出现在侧边栏导航中。用户无法通过任何入口访问该页面。

后端 `/rewards` 和 `/rewards/{reward_id}/confirm` 接口已就绪，但前端缺少对应入口，意味着奖励确认流程在 UI 层面是断裂的。

### 2.3 验收操作缺少成果状态校验

**位置**: `app/services_claims.py:585-656`

`accept_deliverable` 函数未校验成果当前状态。理论上已经 `APPROVED` 或 `REJECTED` 的成果可以被重复验收，导致状态被覆盖、奖励重复生成。

```python
# 缺少类似以下校验：
if deliverable.status not in {DeliverableStatus.SUBMITTED, DeliverableStatus.NEEDS_REWORK}:
    raise HTTPException(status_code=400, detail="当前状态不可验收")
```

---

## 三、🟠 高优先级问题（功能不完整/前后端不一致）

### 3.1 10 个后端接口无前端调用

以下接口已在后端实现，但前端没有对应的 UI 入口：

| 接口 | 功能 | 影响 |
|------|------|------|
| `POST /problems/{id}/analyze` | 手动触发 ProdMind 分析 | 审核人无法手动重新分析 |
| `GET /problems/{id}/hypotheses` | 获取假设验证列表 | 假设验证页面可能数据不完整 |
| `PUT /problems/{id}/hypotheses/{hid}` | 更新假设验证 | 假设验证流程不可操作 |
| `POST /problems/{id}/analysis-ref` | 创建分析引用 | 审核引用功能缺失 |
| `POST /integrations/feishu/sync` | 手动触发飞书同步 | 管理员无法手动同步 |
| `POST /jobs/release-overdue` | 手动释放逾期揭榜 | 管理员无法手动干预 |
| `GET /ai/models/{id}/api-key` | 获取 AI 模型密钥 | 管理员无法查看已配置密钥 |
| `POST /admin/users/{id}/password` | 管理员设置用户密码 | 无法为用户重置密码 |
| `POST /auth/login` | 普通密码登录 | 仅保留了管理员登录入口 |
| `POST /auth/logout` | 登出 | 前端 Bootstrap.tsx:93 有调用，但无 UI 触发入口 |

### 3.2 利益冲突缺少校验

- **审核人可审核自己提交的问题**: `app/routers/problems.py:152-163` 未校验 `actor_id != problem.submitter_id`
- **验收人可验收自己的成果**: `app/services_claims.py:601` 仅校验 `actor_id == task.accepter_id`，未排除 `actor_id == claim.lead_user_id` 的情况
- **用户可揭榜自己提交的问题**: `app/services_claims.py:357-484` 未校验揭榜人与问题提交人的关系

### 3.3 揭榜并发竞态条件

**位置**: `app/services_claims.py:414-422`

揭榜去重检查使用普通 SELECT 查询，无数据库级锁。两个并发请求可能同时通过检查，为同一任务创建重复揭榜。

```python
existing_active = session.exec(
    select(Claim).where(
        Claim.task_id == task_id,
        Claim.lead_user_id == lead_user_id,
        Claim.status == ClaimStatus.ACTIVE,
    )
).first()
```

建议使用 `SELECT ... FOR UPDATE` 或数据库唯一约束。

---

## 四、🟡 中优先级问题（体验割裂/设计缺陷）

### 4.1 前后端权限不一致

| 页面/功能 | 前端权限 | 后端权限 | 差异 |
|-----------|---------|---------|------|
| `/claim-approvals` 揭榜审批 | 所有用户可见 | 审批操作需 admin/reviewer | 普通用户能进入页面但无法操作 |
| 导出功能 | 仅 admin/reviewer 可见 | admin/reviewer/acceptor | acceptor 有权限但看不到入口 |
| `/feishu` 飞书集成 | admin/reviewer/acceptor | 后端飞书接口无角色限制 | 前端多限制了 |
| `/departments` | 无前端限制 | admin/reviewer/acceptor | 前端未做限制 |

### 4.2 成果返工无次数限制

成果可在 `SUBMITTED ↔ NEEDS_REWORK` 之间无限循环，没有最大返工次数限制。任务可能长期卡在 `PENDING_ACCEPTANCE` 状态。

### 4.3 提交审核响应数据不匹配

**前端**: `ProblemsPage.tsx` 调用 `POST /problems/{id}/submit-for-review` 后期望完整 Problem 对象
**后端**: 返回 `ProblemSubmitResult`，仅包含 `id` 和 `status` 字段

前端可能需要额外请求来刷新问题详情。

### 4.4 分析状态与审核流程脱节

ProdMind 分析在提交审核时自动触发，但审核人批准问题时不强制要求分析完成。分析可能仍在 `PENDING` 或 `ANALYZING` 状态时问题就被批准。

---

## 五、🔵 低优先级问题（代码质量/可维护性）

### 5.1 未使用的 Schema 定义

`app/schemas.py` 中 `ClaimApprovalThresholdConfig` 和 `BudgetReviewThresholdConfig` 已定义并导入到 `system.py`，但实际未被任何端点使用。

### 5.2 登出流程不完整

`Bootstrap.tsx:93` 实现了 `/auth/logout` API 调用，但前端 TopBar 的登出按钮仅清除本地 token，未确认是否成功调用了后端登出接口来记录审计日志。

### 5.3 密码安全字段利用不足

`User` 模型中 `password_changed_at`、`failed_login_attempts`、`locked_until` 字段仅在写入时使用，未在任何管理界面或报表中展示，管理员无法查看账户安全状态。

---

## 六、状态机完整性总览

### 问题 (Problem) 状态流转
```
DRAFT → PENDING_REVIEW → APPROVED → ARCHIVED  ✅ 正常
DRAFT → PENDING_REVIEW → REJECTED              ✅ 正常（可从 REJECTED 重新编辑提交）
DRAFT → PENDING_REVIEW → BUDGET_PENDING → APPROVED  ✅ 正常
BUDGET_PENDING → PRICING_REVISION_REQUIRED → PENDING_REVIEW  ✅ 正常
```

### 揭榜 (Claim) 状态流转
```
(新建) → ACTIVE → COMPLETED   ✅ 正常
ACTIVE → ABANDONED             ✅ 正常
ACTIVE → OVERDUE → ???         🔴 死锁，无出口
```

### 成果 (Deliverable) 状态流转
```
SUBMITTED → APPROVED    ✅ 正常
SUBMITTED → REJECTED    ✅ 正常
SUBMITTED → NEEDS_REWORK → SUBMITTED  ⚠️ 可无限循环
```

### 奖励 (Reward) 状态流转
```
GENERATED → CONFIRMED   ✅ 正常（但 UI 入口缺失）
```

---

## 七、建议优先级排序

| 优先级 | 问题 | 建议 |
|--------|------|------|
| P0 | OVERDUE 状态死锁 | 增加 OVERDUE → ABANDONED 转移，或允许管理员手动恢复 |
| P0 | 奖励审核页面未路由 | 在 App.tsx 注册路由并添加侧边栏入口 |
| P0 | 验收缺少状态校验 | 在 accept_deliverable 中增加成果状态前置检查 |
| P1 | 利益冲突校验 | 增加提交人/审核人/验收人互斥校验 |
| P1 | 揭榜并发竞态 | 使用数据库级锁或唯一约束 |
| P1 | 后端接口无前端入口 | 补充手动分析、飞书同步、密码重置等 UI |
| P2 | 前后端权限对齐 | 统一 Guard 和 require_roles 的角色列表 |
| P2 | 返工次数限制 | 增加 max_rework_attempts 配置 |
| P2 | 响应数据不匹配 | 统一 submit-for-review 返回完整 Problem |
