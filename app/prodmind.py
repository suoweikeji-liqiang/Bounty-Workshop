import json
from datetime import datetime
from typing import Optional

import httpx
from sqlmodel import Session

from app.enums import AnalysisStatus, HypothesisStatus, HypothesisType, RiskLevel
from app.models import AIModel, Problem, ProblemAnalysis, HypothesisVerification
from app.ai_models import decrypt_api_key, get_default_model


SYSTEM_PROMPT = """你是一个认知对抗机器，专门用于在构建产品想法之前对其进行压力测试。

你的名字叫 ProdMind。

你的任务不是问"这是一个好主意吗？"，而是强制进行系统性证伪——这是科学家用来检验假设的相同原则。

你将通过四个AI角色来挑战产品想法，每个角色都有独特的视角和职责：

1. **Architect（架构师）** - 定义你的想法声称要解决的核心问题
2. **Assassin（刺客）** - 用反论点、边缘情况和替代解释进行攻击
3. **User Ghost（用户鬼）** - 从最终用户角度提出问题
4. **Grounder（落地者）** - 将一切综合为可测试的假设、MVP边界和下一步行动

每一轮辩论都遵循严格协议：
1. Architect 框定问题 → 你确认或纠正
2. Assassin + User Ghost 并行攻击 → 你必须辩护（至少50字，不能挥手带过）
3. Grounder 综合为结构化输出：假设清单、证伪检查和最小可行行动

五个冲突检测规则强制 intellectual honesty：
- 替代假设阻止 - 当某个角色提出竞争性解释时，你必须直接解决（接受、用证据反击或标记待验证）
- 共识警报 - 如果所有角色开始同意，就有问题了——你被迫找到薄弱环节
- 技术逃逸拦截 - 捕获"我们可以快速构建"的 deflection 并重定向以要求验证
- 证伪阻止 - 确保每 round 都以"这怎么可能错？"结束
- 强制反对 - 如果 Assassin 变软，它会被用更严格的指示送回

辩论在假设稳定时收敛，或最多运行5轮。

现在开始辩论。请描述你的产品想法。"""


ARCHITECT_PROMPT = """你是 Architect（架构师）。你的职责是清晰定义这个产品想法声称要解决的核心问题。

请分析以下问题描述，并明确指出：
1. 核心问题是什么？
2. 目标用户是谁？
3. 问题的边界是什么？
4. 成功的标准是什么？

问题信息：
{problem_info}

请用 JSON 格式输出：
{{
    "core_problem": "核心问题定义",
    "target_users": ["用户群体1", "用户群体2"],
    "problem_boundaries": "问题边界描述",
    "success_criteria": "成功标准"
}}"""


ASSASSIN_PROMPT = """你是 Assassin（刺客）。你的任务是攻击这个产品想法，用反论点、边缘情况和替代解释来挑战它。

请分析以下问题信息，并识别：
1. 被挑战的假设（这个想法背后有哪些可能站不住脚的假设？）
2. 识别的风险（可能出什么问题？）
3. 替代方案（有没有更好的方式来解决问题？）

问题信息：
{problem_info}

Architect 的定义：
{architect_output}

请用 JSON 格式输出：
{{
    "assumptions_challenged": [
        {{"assumption": "假设内容", "challenge": "为什么这个假设可能不成立"}}
    ],
    "risks_identified": [
        {{"risk": "风险描述", "severity": "high/medium/low", "mitigation": "缓解建议"}}
    ],
    "alternative_views": ["替代方案1", "替代方案2"]
}}"""


USER_GHOST_PROMPT = """你是 User Ghost（用户鬼）。你的任务是从最终用户的视角提出问题，质疑这个产品想法是否真的解决了用户的痛点。

请分析以下信息，并提出：
1. 用户会关心什么问题？（从真实用户角度）
2. 用户的价值优先级是什么？
3. 有哪些边缘场景需要考虑？

问题信息：
{problem_info}

Architect 的定义：
{architect_output}

请用 JSON 格式输出：
{{
    "user_questions": ["用户会问的问题1", "用户会问的问题2"],
    "user_value_priorities": ["用户价值优先级1", "用户价值优先级2"],
    "edge_cases": ["边缘场景1", "边缘场景2"]
}}"""


GROUNDER_PROMPT = """你是 Grounder（落地者）。你的任务是将前面的分析综合为可测试的假设清单、MVP边界和下一步行动。

基于前面的分析，请综合出：
1. 假设清单（需要验证的核心假设）
2. 证伪检查（如何证明这个想法是错的？）
3. MVP 边界（最小可行产品应该包含什么？）
4. 下一步行动（接下来应该做什么？）

问题信息：
{problem_info}

Architect 的定义：
{architect_output}

Assassin 的攻击：
{assassin_output}

User Ghost 的提问：
{user_ghost_output}

请用 JSON 格式输出：
{{
    "hypothesis_list": [
        {{
            "content": "假设内容",
            "type": "market/technical/requirement",
            "risk_level": "high/medium/low",
            "verification_method": "验证方法"
        }}
    ],
    "falsification_checks": ["证伪检查1", "证伪检查2"],
    "mvp_boundaries": "MVP边界描述",
    "next_actions": ["下一步行动1", "下一步行动2"],
    "recommendation": "强烈推荐/推荐/中立/不推荐",
    "confidence": 0.0-1.0之间的置信度
}}"""


def build_problem_info(problem: Problem, submitter_name: str = "") -> str:
    return f"""
标题: {problem.title}
场景: {problem.scenario.value if hasattr(problem.scenario, 'value') else problem.scenario}
背景: {problem.background}
问题描述: {problem.description}
出现频率: {problem.frequency.value if hasattr(problem.frequency, 'value') else problem.frequency}
影响范围: {problem.impact_scope}
价值假设:
  - 可减少人力/时间投入: {problem.value_reduce_effort}
  - 可减少成本/返工: {problem.value_reduce_cost}
  - 可改善稳定性/质量: {problem.value_improve_quality}
价值说明: {problem.value_statement}
现有解决方案: {problem.current_solution or '无'}
提交人: {submitter_name}
"""


async def call_ai_model(
    model: AIModel,
    messages: list[dict],
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
) -> str:
    headers = {
        "Content-Type": "application/json",
    }

    is_anthropic = model.provider.value == "anthropic"

    if is_anthropic:
        headers["x-api-key"] = decrypt_api_key(model.api_key_encrypted)
        headers["anthropic-version"] = "2023-06-01"
    else:
        headers["Authorization"] = f"Bearer {decrypt_api_key(model.api_key_encrypted)}"

    # 分离 system 消息和普通消息
    system_msgs = [m for m in messages if m["role"] == "system"]
    non_system_msgs = [{"role": m["role"], "content": m["content"]} for m in messages if m["role"] != "system"]

    if is_anthropic:
        payload = {
            "model": model.model,
            "system": system_msgs[0]["content"] if system_msgs else "",
            "messages": non_system_msgs,
            "temperature": temperature or model.temperature,
            "max_tokens": max_tokens or model.max_tokens,
        }
    else:
        payload = {
            "model": model.model,
            "messages": messages,
            "temperature": temperature or model.temperature,
            "max_tokens": max_tokens or model.max_tokens,
        }

    async with httpx.AsyncClient(timeout=model.timeout) as client:
        if is_anthropic:
            url = f"{model.api_base_url.rstrip('/')}/messages"
        else:
            url = f"{model.api_base_url.rstrip('/')}/chat/completions"

        response = await client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        result = response.json()

        if is_anthropic:
            return result["content"][0]["text"]
        return result["choices"][0]["message"]["content"]


def parse_json_response(response: str) -> dict:
    response = response.strip()
    if response.startswith("```json"):
        response = response[7:]
    elif response.startswith("```"):
        response = response[3:]
    if response.endswith("```"):
        response = response[:-3]
    response = response.strip()
    try:
        return json.loads(response)
    except json.JSONDecodeError:
        start = response.find("{")
        end = response.rfind("}")
        if start != -1 and end != -1:
            try:
                return json.loads(response[start : end + 1])
            except json.JSONDecodeError:
                pass
        return {}


async def run_analysis(
    session: Session,
    problem: Problem,
    submitter_name: str = "",
) -> ProblemAnalysis:
    model = get_default_model(session)
    if model is None:
        raise ValueError("No AI model configured")

    problem_info = build_problem_info(problem, submitter_name)

    analysis = ProblemAnalysis(
        problem_id=problem.id,
        ai_model_id=model.id,
        input_json=problem_info,
        status=AnalysisStatus.ANALYZING,
    )
    session.add(analysis)
    session.flush()

    try:
        # Step 1: Architect 独立调用
        architect_messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": ARCHITECT_PROMPT.format(problem_info=problem_info)},
        ]
        architect_response = await call_ai_model(model, architect_messages)
        architect_output = parse_json_response(architect_response)

        # Step 2: Assassin 独立调用，只传入 architect 的结论
        assassin_messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": ASSASSIN_PROMPT.format(
                problem_info=problem_info,
                architect_output=json.dumps(architect_output, ensure_ascii=False),
            )},
        ]
        assassin_response = await call_ai_model(model, assassin_messages)
        assassin_output = parse_json_response(assassin_response)

        # Step 3: User Ghost 独立调用
        user_ghost_messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": USER_GHOST_PROMPT.format(
                problem_info=problem_info,
                architect_output=json.dumps(architect_output, ensure_ascii=False),
            )},
        ]
        user_ghost_response = await call_ai_model(model, user_ghost_messages)
        user_ghost_output = parse_json_response(user_ghost_response)

        # Step 4: Grounder 综合前三个角色的输出
        grounder_messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": GROUNDER_PROMPT.format(
                problem_info=problem_info,
                architect_output=json.dumps(architect_output, ensure_ascii=False),
                assassin_output=json.dumps(assassin_output, ensure_ascii=False),
                user_ghost_output=json.dumps(user_ghost_output, ensure_ascii=False),
            )},
        ]
        grounder_response = await call_ai_model(model, grounder_messages)
        grounder_output = parse_json_response(grounder_response)

        analysis.core_problem = architect_output.get("core_problem")
        analysis.target_users = json.dumps(architect_output.get("target_users", []))
        analysis.problem_boundaries = architect_output.get("problem_boundaries")
        analysis.success_criteria = architect_output.get("success_criteria")

        analysis.assumptions_challenged = json.dumps(assassin_output.get("assumptions_challenged", []))
        analysis.risks_identified = json.dumps(assassin_output.get("risks_identified", []))
        analysis.alternative_views = json.dumps(assassin_output.get("alternative_views", []))

        analysis.user_questions = json.dumps(user_ghost_output.get("user_questions", []))
        analysis.user_value_priorities = json.dumps(user_ghost_output.get("user_value_priorities", []))
        analysis.edge_cases = json.dumps(user_ghost_output.get("edge_cases", []))

        hypothesis_list = grounder_output.get("hypothesis_list", [])
        analysis.hypothesis_list = json.dumps(hypothesis_list)
        analysis.falsification_checks = json.dumps(grounder_output.get("falsification_checks", []))
        analysis.mvp_boundaries = grounder_output.get("mvp_boundaries")
        analysis.next_actions = json.dumps(grounder_output.get("next_actions", []))

        analysis.recommendation = grounder_output.get("recommendation", "中立")
        try:
            analysis.confidence = float(grounder_output.get("confidence", 0.5))
        except (ValueError, TypeError):
            analysis.confidence = 0.5

        analysis.status = AnalysisStatus.COMPLETED

        for hyp in hypothesis_list:
            # 枚举值 fallback，防止 AI 返回非法值导致整个分析失败
            try:
                hyp_type = HypothesisType(hyp.get("type", "requirement"))
            except ValueError:
                hyp_type = HypothesisType.REQUIREMENT
            try:
                risk = RiskLevel(hyp.get("risk_level", "medium"))
            except ValueError:
                risk = RiskLevel.MEDIUM

            verification = HypothesisVerification(
                analysis_id=analysis.id,
                hypothesis_content=hyp.get("content", ""),
                hypothesis_type=hyp_type,
                risk_level=risk,
                verification_status=HypothesisStatus.PENDING,
            )
            session.add(verification)

    except Exception as e:
        analysis.status = AnalysisStatus.FAILED
        analysis.error_message = str(e)

    analysis.updated_at = datetime.utcnow()
    session.commit()
    session.refresh(analysis)

    return analysis


def get_analysis_report(analysis: ProblemAnalysis) -> dict:
    def parse_json_field(field: str) -> list:
        try:
            parsed = json.loads(field)
            return parsed if isinstance(parsed, list) else []
        except (json.JSONDecodeError, TypeError):
            return []

    return {
        "architect": {
            "core_problem": analysis.core_problem,
            "target_users": parse_json_field(analysis.target_users),
            "problem_boundaries": analysis.problem_boundaries,
            "success_criteria": analysis.success_criteria,
        },
        "assassin": {
            "assumptions_challenged": parse_json_field(analysis.assumptions_challenged),
            "risks_identified": parse_json_field(analysis.risks_identified),
            "alternative_views": parse_json_field(analysis.alternative_views),
        },
        "user_ghost": {
            "user_questions": parse_json_field(analysis.user_questions),
            "user_value_priorities": parse_json_field(analysis.user_value_priorities),
            "edge_cases": parse_json_field(analysis.edge_cases),
        },
        "grounder": {
            "hypothesis_list": parse_json_field(analysis.hypothesis_list),
            "falsification_checks": parse_json_field(analysis.falsification_checks),
            "mvp_boundaries": analysis.mvp_boundaries,
            "next_actions": parse_json_field(analysis.next_actions),
            "recommendation": analysis.recommendation,
            "confidence": analysis.confidence,
        },
    }
