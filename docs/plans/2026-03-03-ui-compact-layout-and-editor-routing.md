# UI Compact Layout And Editor Routing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 全站统一“筛选置顶、筛选简洁、可一行不两行”，并将“新建/编辑”从内嵌或弹窗改为独立页面，优先修复 `ProblemsPage` 的结构问题。

**Architecture:** 保持现有业务 API 不变，主要做前端结构重排与路由拆分。先抽象通用筛选栏样式与布局，再逐页套用；对新建/编辑流程采用“列表页 + 独立编辑页”模式，避免在列表页堆叠大表单造成空间浪费。

**Tech Stack:** React 18, TypeScript, React Router, CSS

---

## 0. 审查结论（按页面）

### 0.1 明确不符合本轮标准

- `web/src/pages/ProblemsPage.tsx:443`
  - 问题列表在前，筛选在后，不符合“筛选应处于最上方”。
- `web/src/pages/ProblemsPage.tsx:576`
  - 新建/编辑草稿与列表同页内嵌，导致页面过长且产生明显无效留白。
- `web/src/pages/ProblemsPage.tsx:523`
  - 筛选区解释文案过长，视觉冗余。

### 0.2 基本符合“筛选置顶”但不够简洁

- `web/src/pages/TaskHallPage.tsx:451`
- `web/src/pages/KnowledgePage.tsx:122`
- `web/src/pages/OperationLogsPage.tsx:106`
- `web/src/pages/RewardReviewPage.tsx:123`
- `web/src/pages/UsersPage.tsx:243`

问题共同点：筛选区存在说明性文案/多行堆叠，按钮与关键筛选项未形成紧凑的一行工具栏风格。

### 0.3 需要纳入“编辑独立页”治理范围（第二优先级）

- `web/src/pages/AIModelConfigPage.tsx:382`（新增/编辑模型仍为弹窗）
- `web/src/pages/UsersPage.tsx:332`（用户管理仍为弹窗）

---

### Task 1: 抽象全站紧凑筛选栏规范与样式

**Files:**
- Modify: `web/src/styles/components.css`
- Modify: `web/src/styles/responsive.css`
- Modify: `web/src/styles/layout.css`

**Step 1: 定义统一筛选容器样式**

新增样式族：
- `.filter-panel`（筛选容器，始终位于页面内容首块）
- `.filter-toolbar`（桌面端优先单行，允许溢出换行但保持紧凑）
- `.filter-actions`（应用/重置/刷新按钮组）
- `.filter-field.compact`（短标签、短输入框）

**Step 2: 清理导致“可一行却两行”的默认间距**

调整 `h3`、`label`、`button-row` 在筛选场景下的专用间距，避免影响非筛选面板。

**Step 3: 响应式约束**

- Desktop: 优先单行展示关键筛选字段 + 操作按钮。
- Tablet/Mobile: 合理换行，不出现大块空白列。

**Step 4: 验证**

Run: `cd web && npm run build`
Expected: PASS

---

### Task 2: 全量筛选页落地“筛选置顶 + 紧凑工具栏”

**Files:**
- Modify: `web/src/pages/ProblemsPage.tsx`
- Modify: `web/src/pages/TaskHallPage.tsx`
- Modify: `web/src/pages/KnowledgePage.tsx`
- Modify: `web/src/pages/OperationLogsPage.tsx`
- Modify: `web/src/pages/RewardReviewPage.tsx`
- Modify: `web/src/pages/UsersPage.tsx`

**Step 1: 统一结构顺序**

在每个含筛选页面中强制顺序：
1) `page-head`
2) `filter-panel`
3) 列表面板
4) 详情/次级区域

**Step 2: 删除冗余说明文案**

删除“修改筛选后点击应用筛选...”这类可由交互本身表达的信息，保留必要占位提示。

**Step 3: 单行优先布局**

将高频筛选项（状态、场景、日期、关键字、等级）排入同一工具行，按钮组固定右侧（小屏下换行）。

**Step 4: 验证**

Run: `cd web && npm run build`
Expected: PASS

---

### Task 3: 拆分问题草稿为独立页面（本轮核心）

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/pages/ProblemsPage.tsx`
- Create: `web/src/pages/ProblemDraftEditorPage.tsx`
- Create: `web/src/components/ProblemDraftForm.tsx`
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/types.ts`

**Step 1: 新增路由**

新增：
- `/problems/new`
- `/problems/:problemId/edit`

列表页仅保留：筛选 + 列表 + 详情查看。

**Step 2: 表单组件抽离**

把当前 `ProblemsPage` 草稿编辑表单（标题、场景、价值、验收标准、附件等）提炼到 `ProblemDraftForm`，供新建与编辑页复用。

**Step 3: 跳转替代内嵌**

- “新建草稿”按钮跳转 `/problems/new`
- 行内“编辑”按钮跳转 `/problems/:id/edit`
- 保存成功后回跳 `/problems` 并保留筛选参数（query string）

**Step 4: 移除列表页内嵌草稿区**

删除 `composerOpen` 折叠逻辑与内嵌大表单，避免出现左侧空白/纵向冗长。

**Step 5: 验证**

Run: `cd web && npm run build`
Expected: PASS

---

### Task 4: 第二优先级 - 统一“编辑必须独立页”策略

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/pages/AIModelConfigPage.tsx`
- Modify: `web/src/pages/UsersPage.tsx`
- Create: `web/src/pages/AIModelEditorPage.tsx`
- Create: `web/src/pages/UserManagePage.tsx`

**Step 1: AI 模型编辑页化**

新增：
- `/ai-models/new`
- `/ai-models/:id/edit`

保留“详情”弹窗可选，但新增/编辑不再弹窗。

**Step 2: 用户管理页化（可分批）**

新增：
- `/users/:id/manage`

将角色配置、启停账号、密码重置迁移到独立页面，减少弹窗复杂度。

**Step 3: 验证**

Run: `cd web && npm run build`
Expected: PASS

---

### Task 5: UI 验收与回归

**Files:**
- Modify: `web/e2e/main-flow.spec.ts`
- Modify: `docs/整改计划与执行报告.md`

**Step 1: 新增/更新 E2E 场景**

覆盖：
- 问题页加载后首屏先看到筛选栏
- 点击“新建草稿”进入新路由页面
- 点击“编辑”进入编辑路由页面
- 保存后返回列表且筛选条件保留

**Step 2: 手工验收清单**

- 1920 宽度下：筛选主字段和操作按钮优先单行
- 1366 宽度下：不出现大片无效左侧留白
- 移动端：筛选按需换行但字段顺序一致

**Step 3: 验证**

Run: `cd web && npm run build`
Expected: PASS

Run: `cd web && npx playwright test`
Expected: PASS

---

## 执行顺序建议

1. Task 1 → Task 2（先统一筛选规范）
2. Task 3（完成你当前最关注的问题提报页）
3. Task 4（处理其余编辑弹窗页）
4. Task 5（回归与验收）

