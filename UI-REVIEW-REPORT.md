# Bounty Workshop UI 审查报告

**审查日期**: 2026-02-26
**审查范围**: 全部前端页面组件、样式文件、应用外壳
**审查维度**: 布局合理性、操作便捷性、响应式适配、可访问性、一致性

---

## 一、严重问题（需立即修复）

### 1.1 RewardReviewPage 中文乱码（编码损坏）

**文件**: `web/src/pages/RewardReviewPage.tsx:83-97`

页面标题和所有中文标签均为乱码（mojibake），例如：
- `婵€鍔卞鏍` → 应为"激励审核"
- `绛涢€` → 应为"筛选"
- `寰呯'璁` → 应为"待确认"

此外，金额前缀显示为 `楼` 而非 `¥`，操作按钮文本为英文 `confirm` / `Confirmed`，与全站中文风格不一致。

**影响**: 该页面完全不可用，用户无法理解任何文字内容。

### 1.2 假设验证页使用浏览器 `prompt()` 对话框

**文件**: `web/src/pages/HypothesisVerificationPage.tsx:248-264`

验证假设时通过 `prompt()` 收集"验证方法"和"验证结果"，存在以下问题：
- 浏览器原生弹窗无法自定义样式，与系统整体 UI 风格割裂
- 不支持多行输入，不适合填写详细验证结果
- 屏幕阅读器等辅助工具对 `prompt()` 支持差
- 用户误点取消则整个操作丢失，无法恢复

**建议**: 替换为页内 Modal 表单，包含验证方法和验证结果两个字段。

---

## 二、布局与结构问题

### 2.1 超长单页面缺少分区导航

以下页面在单个页面内堆叠了 5-7 个功能区块，滚动距离过长：

| 页面 | 区块数 | 主要区块 |
|------|--------|----------|
| TaskHallPage | 7 | 审批策略、筛选、可揭榜列表、揭榜设置、进行中列表、成果提交、详情弹窗 |
| ExecutionLoopPage | 5+ | 模板配置、揭榜记录、成果提交、待验收、激励确认、详情弹窗 |
| ProblemsPage | 3+ | 问题提交表单、筛选、问题列表 |

**问题**: 用户需要反复上下滚动才能在不同区块间操作，尤其在"揭榜→提交成果"这类连续操作流程中体验较差。

**建议**:
- 为长页面增加锚点导航或 Tab 切换
- 将不常用的配置区块（如模板配置、审批策略）设为可折叠

### 2.2 表格内嵌编辑器空间局促

**文件**: `ExecutionLoopPage.tsx:502-548`, `ClaimApprovalPage.tsx:169-175`

验收编辑器直接嵌入表格行下方，包含下拉框、模板按钮、文本域和提交按钮，在窄屏下非常拥挤。审批页面的评论输入也直接嵌在表格单元格内。

**建议**: 将复杂编辑操作移至侧滑面板或 Modal 中，保持表格行的简洁。

### 2.3 Modal 弹窗内容过长无滚动提示

**文件**: `ExecutionLoopPage.tsx:590-678`, `TaskHallPage.tsx:666-690`

详情弹窗包含多个 section（验收标准、成果内容、证据链接、验收历史），内容可能超出 `max-height: 86vh`。虽然设置了 `overflow: auto`，但没有视觉提示告知用户可以滚动。

---

## 三、响应式与移动端问题

### 3.1 侧边栏在小屏下变为水平滚动

**文件**: `web/src/styles/responsive.css:22-28`

900px 以下时侧边栏从垂直布局变为水平滚动：
```css
.sidenav {
  grid-auto-flow: column;
  grid-auto-columns: max-content;
  overflow-x: auto;
}
```

20+ 个导航项水平排列需要大量横向滚动，用户很难找到目标菜单项。

**建议**: 改为汉堡菜单 + 抽屉式导航。

### 3.2 多列表格无响应式适配

以下表格在移动端会严重溢出或变形：

| 表格 | 列数 | 响应式规则 |
|------|------|-----------|
| `.problems-row` | 8列 | 无 |
| `.personal-row` | 8列 | 仅折叠为2列，信息丢失严重 |
| `.approval-review-row` | 7列 | 无 |
| `.op-log-row` | 6列 | 无 |
| `.trend-row` | 3列（含硬编码宽度） | 无 |

**建议**:
- 移动端优先显示关键列，次要列可折叠展开
- 或改为卡片式布局

### 3.3 缺少中间断点

当前仅有 `1200px` 和 `900px` 两个断点，缺少平板竖屏（768px）和小屏手机（480px）的适配。`.personal-kpis` 的 5 列网格在平板上会非常拥挤。

---

## 四、操作便捷性问题

### 4.1 危险操作缺少二次确认

以下操作点击后直接执行，无确认对话框：

| 页面 | 操作 | 风险 |
|------|------|------|
| ExecutionLoopPage | 放弃揭榜 | 不可逆 |
| ClaimApprovalPage | 通过/驳回审批 | 影响他人 |
| AIModelConfigPage | 删除模型 | 不可逆 |
| RewardReviewPage | 确认激励 | 涉及资金 |

**建议**: 至少对"放弃揭榜"、"删除模型"、"确认激励"增加确认弹窗。

### 4.2 分页信息不完整

**文件**: `KnowledgePage.tsx`, `RewardReviewPage.tsx`

分页控件仅显示"第 N 页"，缺少总页数和总记录数。用户无法判断数据规模和当前位置。部分页面（AttachmentsPage、OperationLogsPage、PersonalCenterPage）完全没有分页。

### 4.3 表单缺少实时校验

多数表单仅在提交时校验，例如：
- TaskHallPage 团队成员比例之和校验（提交时才报错）
- HypothesisVerificationPage 问题 ID 校验（点击按钮才提示）
- ChangePasswordPage 密码匹配校验（提交时才检查）

**建议**: 增加输入时的即时反馈，如比例总和实时显示、密码匹配实时提示。

### 4.4 操作日志详情显示原始 JSON

**文件**: `OperationLogsPage.tsx:129`

操作日志的"详情"列直接显示未格式化的 JSON 字符串，不可读。

**建议**: 改为可展开的格式化 JSON 显示，或提取关键字段展示。

---

## 五、样式一致性问题

### 5.1 状态标识缺少视觉区分

多数页面的状态值以纯文本显示（如"进行中"、"已提交"、"已通过"），没有颜色标签或图标区分。仅 HypothesisVerificationPage 使用了颜色标签，但用了硬编码颜色而非 CSS 变量。

**建议**: 统一使用带颜色的 Badge 组件显示状态。

### 5.2 CSS 变量使用不一致

以下位置使用了硬编码值而非已定义的 CSS 变量：

| 位置 | 硬编码值 | 应使用 |
|------|----------|--------|
| `.acceptance-editor` border-radius | `12px` | `var(--radius-md)` (10px) |
| `.analysis-summary` border-radius | `8px` | `var(--radius-md)` |
| `.hypothesis-item` border-radius | `4px` | `var(--radius-sm)` (6px) |
| 风险等级颜色 | `#fee2e2`, `#dc2626` 等 | 应定义为 CSS 变量 |
| `.personal-meta-pill` 背景色 | `rgba(...)` 硬编码 | 应定义为变量 |

### 5.3 未定义的 CSS 变量引用

- `.acceptance-editor` 引用了 `var(--line)`，但 `variables.css` 中未定义
- `.trend-row .bar i` 引用了 `var(--gradient-success)`，但 `variables.css` 中未定义

### 5.4 中英文混用

- RewardReviewPage: 按钮文本 `confirm` / `Confirmed` 为英文
- 部分错误消息为英文（如 `Failed to load rewards`）
- 其余页面均为中文

---

## 六、可访问性问题

### 6.1 Modal 缺少 ARIA 属性

所有 Modal 弹窗（ExecutionLoopPage、TaskHallPage、KnowledgePage）均缺少：
- `role="dialog"`
- `aria-modal="true"`
- `aria-labelledby` 指向标题
- 焦点陷阱（focus trap）

### 6.2 字号过小

- `.topbar .kicker`: 11px
- `.topbar-controls label`: 11px
- `.row.head`: 13px

WCAG 建议正文最小 14px，这些元素在高分辨率屏幕上可能难以阅读。

### 6.3 颜色对比度不足

- `.personal-badge`: `rgba(59,130,246,0.1)` 背景 + `var(--brand-primary)` 文字，对比度偏低
- `.personal-meta-pill`: 半透明白色背景 + 次要文字色，对比度不足
- 风险等级仅靠颜色区分（红/黄/绿），缺少文字或图标辅助

### 6.4 缺少焦点样式

`.sidenav a` 和 `.ranking-list li` 没有 `:focus` 样式，键盘导航用户无法看到当前焦点位置。

---

## 七、加载与空状态

### 7.1 缺少加载骨架屏

所有页面在数据加载期间显示空白内容，没有骨架屏或占位符。DashboardPage 的 KPI 卡片在加载时显示 `-`，但没有明确的加载指示。

### 7.2 部分页面缺少空状态提示

AttachmentsPage 在无附件时没有任何提示文字，用户可能以为页面加载失败。

### 7.3 应用初始化无加载状态

**文件**: `App.tsx:116-118`

`loadingProfile` 状态存在但未渲染任何 UI，用户在 profile 加载期间看到空白页面后直接跳转到登录页。

---

## 八、问题优先级汇总

| 优先级 | 问题 | 影响范围 |
|--------|------|----------|
| P0 | RewardReviewPage 中文乱码 | 整页不可用 |
| P0 | 未定义的 CSS 变量引用 | 样式渲染异常 |
| P1 | `prompt()` 替换为 Modal 表单 | HypothesisVerificationPage |
| P1 | 危险操作增加二次确认 | 多个页面 |
| P1 | 移动端侧边栏导航重构 | 全局 |
| P2 | 超长页面增加分区导航 | TaskHallPage, ExecutionLoopPage |
| P2 | 表格响应式适配 | 多个页面 |
| P2 | 状态标识统一为 Badge | 全局 |
| P2 | Modal ARIA 属性补全 | 全局 |
| P3 | 加载骨架屏 | 全局 |
| P3 | 分页信息完善 | 多个页面 |
| P3 | 表单实时校验 | 多个页面 |
| P3 | CSS 变量统一 | 样式文件 |
| P3 | 字号与对比度优化 | 样式文件 |
