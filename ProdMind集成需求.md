# 揭榜挂帅系统 ProdMind 集成优化需求

## 一、背景与目标

### 1.1 现状问题

当前揭榜挂帅系统在问题审核阶段存在以下痛点：

| 问题 | 影响 |
|------|------|
| 问题定义模糊 | 审核人难以判断任务价值，导致低质量任务进入揭榜池 |
| 假设未经验证 | 价值假设（如"可提效50%"）缺乏数据支撑 |
| 缺乏深度论证 | 审核人单方面判断，无对抗性思考 |
| 市场需求不确定 | 未验证问题是否真实存在于目标用户群体 |

### 1.2 优化目标

**在任务立项之前，引入 ProdMind 提供全面的思维框架和验证工具，帮助团队判断任务是否值得立项，并确保任务定义和目标明确、可执行。**

---

## 二、ProdMind 机制适配

### 2.1 角色映射

将 ProdMind 的四个 AI 角色适配到揭榜挂帅场景：

| ProdMind 角色 | 揭榜挂帅场景 | 职责 |
|---------------|--------------|------|
| **Architect** | 架构师 | 清晰定义问题核心、目标用户、需求边界 |
| **Assassin** | 刺客 | 攻击假设、挑战可行性、识别潜在风险 |
| **User Ghost** | 用户鬼 | 从最终用户视角提问，验证真实需求 |
| **Grounder** | 落地者 | 综合为可验证的假设清单、MVP边界、行动项 |

### 2.2 集成流程

```
[问题提交] → [ProdMind 论证] → [审核人立项决策] → [任务定义]
                ↑
           AI 对抗性论证
           生成假设清单
```

---

## 三、功能需求

### 3.1 ProdMind 论证模块

#### 3.1.1 论证触发

- **触发时机**：问题提交时自动触发论证
- **触发方式**：用户在提交问题的同时，系统自动运行 ProdMind 论证
- **触发条件**：问题创建时自动触发，论证结果作为问题信息的一部分提交给审核人
- **前置条件**：系统已配置有效的 AI 模型

**重新论证场景**：
- 审核人可将问题退回修改，修改提交后自动重新触发论证
- 审核人也可手动点击"重新论证"按钮

#### 3.1.2 论证输入

将问题的以下字段转换为结构化输入：

```python
class ProdMindInput:
    # 问题基本信息
    title: str                          # 问题标题
    scenario: str                       # 场景（研发/运维/交付/支持/其他）
    background: str                     # 问题背景
    description: str                    # 问题描述（具体痛点）
    frequency: str                      # 出现频率
    impact_scope: str                   # 影响范围
    
    # 价值假设
    value_reduce_effort: bool          # 可减少人力/时间投入
    value_reduce_cost: bool            # 可减少成本/返工
    value_improve_quality: bool         # 可改善稳定性/质量
    value_statement: str                # 价值假设说明
    
    # 约束条件
    current_solution: str               # 现有处理方式
    submitter_department: str           # 提交人部门
```

#### 3.1.3 论证输出

```python
class ProdMindOutput:
    # Architect 输出
    core_problem: str                   # 核心问题定义
    target_users: list[str]             # 目标用户群体
    problem_boundaries: str             # 问题边界
    success_criteria: str                # 成功标准
    
    # Assassin 攻击点
    assumptions_challenged: list[dict]  # 被挑战的假设
    risks_identified: list[dict]        # 识别的风险
    alternative_views: list[str]         # 替代方案
    
    # User Ghost 问题
    user_questions: list[str]           # 用户视角问题
    user_value_priorities: list[str]    # 用户价值优先级
    edge_cases: list[str]               # 边缘场景
    
    # Grounder 综合
    hypothesis_list: list[Hypothesis]    # 假设清单
    falsification_checks: list[str]     # 证伪检查项
    mvp_boundaries: str                  # MVP 边界
    next_actions: list[str]             # 下一步行动
    
class Hypothesis:
    content: str                        # 假设内容
    type: str                           # 类型（市场/技术/需求）
    verification_method: str            # 验证方法
    risk_level: str                     # 风险等级
```

### 3.2 假设验证工作台

#### 3.2.1 假设清单展示

- 展示 ProdMind 生成的完整假设清单
- 每条假设包含：
  - 假设内容
  - 类型标签（市场/技术/需求）
  - 建议验证方法
  - 风险等级（高/中/低）
- 支持审核人标记验证状态

#### 3.2.2 验证状态管理

```python
class HypothesisVerification:
    hypothesis_id: str
    status: str                        # pending/verified/rejected
    verification_method: str            # 实际验证方式
    verification_result: str            # 验证结果
    verified_by: int                    # 审核人ID
    verified_at: datetime
```

### 3.3 论证报告生成

#### 3.3.1 报告结构

```
## ProdMind 论证报告

### 一、问题重构（Architect）
- 核心问题：
- 目标用户：
- 问题边界：
- 成功标准：

### 二、假设挑战（Assassin）
- 被挑战的假设：
- 识别的风险：
- 替代方案：

### 三、用户视角（User Ghost）
- 用户关心的问题：
- 价值优先级：
- 边缘场景：

### 四、综合输出（Grounder）
- 假设清单（含验证计划）：
- MVP 边界：
- 下一步行动：

### 五、论证结论
- 立项建议：[强烈推荐/推荐/中立/不推荐]
- 关键风险点：
- 需补充信息：
```

#### 3.3.2 导出功能

- 支持导出为 Markdown 格式
- 支持导出为 PDF 格式（可选）
- 报告关联到问题记录

### 3.4 审核流程集成

#### 3.4.1 流程变更

**原流程**：
```
问题提交 → 审核人审核 → 立项/不立项
```

**新流程**：
```
问题提交 → ProdMind 论证 → 审核人审核（含论证参考）→ 立项/不立项
```

#### 3.4.2 状态变更

| 状态 | 说明 |
|------|------|
| `PENDING_REVIEW` | 待审核（未运行论证） |
| `ANALYZING` | 论证中 |
| `ANALYZED` | 论证完成 |
| `REJECTED` | 不立项 |

#### 3.4.3 审核增强（必参考项）

**论证结果作为立项审核的必参考项**，审核人在做出立项决策时必须查看并考虑 ProdMind 论证报告：

审核人在审核页面可查看：
- ProdMind 论证报告
- 假设清单及验证状态
- 立项建议及置信度

**立项约束**：
- 审核人必须填写对论证建议的采纳意见（必填）
- 如果不采纳论证建议（如建议"不推荐立项"但审核人选择"立项"），必须填写充分的理由
- 审核记录需包含论证参考情况

---

## 四、非功能需求

### 4.1 性能需求

- 论证生成时间 ≤ 30 秒（单轮）
- 支持最多 5 轮论证
- 并发论证数量限制：10

### 4.2 配置需求

#### 4.2.1 多供应商模型管理

支持多供应商、多模型配置管理：

| 供应商 | 支持模型 | 说明 |
|--------|----------|------|
| OpenAI | gpt-4o, gpt-4o-mini, gpt-4-turbo | 官方 API |
| Anthropic | claude-3-opus, claude-3-sonnet, claude-3-haiku | Claude 系列 |
| DeepSeek | deepseek-chat, deepseek-coder | 深度求索 |
| 硅基流动 | 支持所有 SiliconFlow 兼容模型 | 第三方聚合 |
| Ollama | 本地部署的所有模型 | 本地运行 |
| 自定义 | 任何 OpenAI 兼容 API | 支持企业内部模型 |

#### 4.2.2 模型配置项

每个模型配置包含：
```python
class ModelConfig:
    id: str                          # 配置唯一标识
    name: str                        # 显示名称
    provider: str                    # 供应商类型
    api_base_url: str               # API 地址
    api_key: str                    # API Key（加密存储）
    model: str                      # 模型名称
    default: bool                   # 是否为默认模型
    enabled: bool                   # 是否启用
    max_tokens: int                 # 最大输出 tokens
    temperature: float              # 采样温度
    timeout: int                    # 超时时间（秒）
```

#### 4.2.3 配置管理接口

- 管理员可新增/编辑/删除模型配置
- 支持设置默认模型
- 支持模型启用/禁用
- API Key 加密存储（AES-256）

### 4.3 审计需求

- 记录每次论证的完整输入输出
- 记录审核人对论证的采纳情况

---

## 五、数据模型扩展

### 5.1 新增表

```python
class ProblemAnalysis(SQLModel, table=True):
    """问题论证记录"""
    id: Optional[int] = Field(default=None, primary_key=True)
    problem_id: int = Field(foreign_key="problem.id", index=True)
    
    # 论证输入（JSON）
    input_json: str
    
    # Architect 输出
    core_problem: str
    target_users: str                # JSON 数组
    problem_boundaries: str
    success_criteria: str
    
    # Assassin 输出
    assumptions_challenged: str      # JSON 数组
    risks_identified: str            # JSON 数组
    alternative_views: str           # JSON 数组
    
    # User Ghost 输出
    user_questions: str              # JSON 数组
    user_value_priorities: str       # JSON 数组
    edge_cases: str                  # JSON 数组
    
    # Grounder 输出
    hypothesis_list: str              # JSON 数组
    falsification_checks: str        # JSON 数组
    mvp_boundaries: str
    next_actions: str                # JSON 数组
    
    # 综合结论
    recommendation: str               # 强烈推荐/推荐/中立/不推荐
    confidence: float                # 置信度 0-1
    
    # 元数据
    rounds: int = Field(default=1)    # 论证轮数
    model: str
    status: str                      # analyzing/completed/failed
    
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class HypothesisVerification(SQLModel, table=True):
    """假设验证记录"""
    id: Optional[int] = Field(default=None, primary_key=True)
    analysis_id: int = Field(foreign_key="problem_analysis.id", index=True)
    
    hypothesis_content: str
    hypothesis_type: str             # market/technical/requirement
    risk_level: str                 # high/medium/low
    
    verification_status: str         # pending/verified/rejected
    verification_method: str
    verification_result: str
    verified_by: int = Field(foreign_key="user.id")
    verified_at: datetime = Field(default_factory=datetime.utcnow)
    created_at: datetime = Field(default_factory=datetime.utcnow)
```

### 5.2 Problem 表扩展

```python
class Problem(SQLModel, table=True):
    # ... 现有字段 ...
    
    # 新增字段
    analysis_id: Optional[int] = Field(default=None, foreign_key="problem_analysis.id")
    analysis_status: str = Field(default="pending")  # pending/analyzing/analyzed/failed
    recommendation: Optional[str] = Field(default=None)  # 论证建议
    confidence: Optional[float] = Field(default=None)  # 置信度
```

---

## 六、API 设计

### 6.1 新增接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/problems/{problem_id}/analyze` | POST | 触发 ProdMind 论证 |
| `/problems/{problem_id}/analysis` | GET | 获取论证报告 |
| `/problems/{problem_id}/hypotheses` | GET | 获取假设清单 |
| `/problems/{problem_id}/hypotheses/{hypothesis_id}` | PUT | 更新假设验证状态 |
| `/system/config/prodmind` | GET/PUT | ProdMind 配置 |

### 6.2 接口详情

#### 6.2.1 触发论证

```http
POST /problems/{problem_id}/analyze
Authorization: Bearer <token>

Response 202:
{
    "analysis_id": 123,
    "status": "analyzing",
    "message": "论证已启动"
}
```

#### 6.2.2 获取论证报告

```http
GET /problems/{problem_id}/analysis
Authorization: Bearer <token>

Response 200:
{
    "id": 123,
    "problem_id": 456,
    "status": "completed",
    "recommendation": "推荐",
    "confidence": 0.75,
    "report": {
        "architect": {...},
        "assassin": {...},
        "user_ghost": {...},
        "grounder": {...}
    },
    "created_at": "2026-02-20T10:00:00Z"
}
```

---

## 七、前端页面变更

### 7.1 问题详情页增强

在问题详情页新增"ProdMind 论证"标签页：

```
┌─────────────────────────────────────────┐
│ 问题详情                        [论证报告] │
├─────────────────────────────────────────┤
│ [基本信息] [论证报告] [审核历史]          │
├─────────────────────────────────────────┤
│                                         │
│  📊 立项建议：推荐（置信度 75%）        │
│                                         │
│ ┌─ 假设清单 ─────────────────────────┐  │
│ │ ○ 可减少人力投入  [验证] [质疑]     │  │
│ │ ● 市场需求真实    [已验证 ✓]       │  │
│ │ ○ 技术方案可行    [待验证]         │  │
│ └────────────────────────────────────┘  │
│                                         │
│ [查看完整报告] [重新论证]               │
└─────────────────────────────────────────┘
```

### 7.2 审核页增强

审核人在审核问题时可查看：
- ProdMind 论证摘要
- 关键风险提示
- 假设验证状态

---

## 八、实施建议

### 8.1 分阶段实施

| 阶段 | 内容 | 优先级 |
|------|------|--------|
| Phase 1 | 基础论证生成 + 报告展示 + **假设验证工作台** | P0 |
| Phase 2 | 多轮论证、冲突检测 | P1 |
| Phase 3 | 竞品分析自动生成 | P2 |

> **注意**：假设验证工作台与基础论证同步开发，因为论证结果需要作为必参考项，必须配套假设验证功能。

### 8.2 技术选型

- 直接复用 ProdMind 的 prompt 工程
- 支持多供应商、多模型管理（OpenAI / Claude / DeepSeek / 硅基流动 / Ollama / 自定义）
- 使用 OpenAI 兼容 API 接口，便于扩展

---

## 九、价值预期

| 指标 | 预期改善 |
|------|----------|
| 问题质量 | 减少 30% 低质量任务进入揭榜池 |
| 假设验证 | 立项前完成 100% 假设验证 |
| 审核效率 | 审核时间减少 20%（有论证参考） |
| 任务完成率 | 提升 15%（目标明确） |

---

## 十、需求确认总结

根据沟通确认的需求：

| 需求项 | 确认内容 |
|--------|----------|
| **论证触发时机** | 问题提交时自动触发论证，论证结果作为问题信息的一部分提交给审核人 |
| **论证法律效力** | 作为**必参考项**，审核人必须填写对论证建议的采纳意见；不采纳时需填写理由 |
| **模型配置** | 支持多供应商、多模型管理（OpenAI / Claude / DeepSeek / 硅基流动 / Ollama / 自定义） |
| **实施范围** | Phase 1 同步开发假设验证工作台 |

---

*文档版本：v1.1*
*最后更新：2026-02-20*
