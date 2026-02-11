const workflowSteps = [
  '问题提报：员工提交痛点、背景与价值假设。',
  '审核立项：评审确认是否立项，并定义任务边界。',
  '揭榜执行：个人或团队认领任务并按计划交付。',
  '成果验收：验收人按标准判定通过、整改或驳回。',
  '激励确认：系统生成激励，管理侧确认发放。',
  '知识沉淀：通过验收的案例自动归档到知识库。',
]

const roleRows = [
  { role: '系统管理员', duty: '角色分配、系统参数与集成配置' },
  { role: '评审角色', duty: '问题审核、任务定义、激励确认' },
  { role: '验收角色', duty: '按验收标准评估成果质量' },
  { role: '员工角色', duty: '提报问题、揭榜执行、提交成果' },
]

const levelRows = [
  { level: 'S', range: '8000 - 15000 元', note: '核心流程优化、关键降本' },
  { level: 'A', range: '3000 - 8000 元', note: '明显提效或稳定性提升' },
  { level: 'B', range: '1000 - 3000 元', note: '工具化或自动化优化' },
  { level: 'C', range: '200 - 1000 元', note: '小型改进、修复类事项' },
]

export function SystemGuidePage() {
  return (
    <section className="page-wrap guide-page">
      <header className="page-head">
        <h2>系统说明</h2>
        <p>基于《揭榜挂帅任务管理制度》与《软件需求规格说明》的核心内容整理。</p>
      </header>

      <article className="panel guide-card">
        <h3>系统目标</h3>
        <p>
          这套系统用于把“问题发现 - 立项 - 执行 - 验收 - 激励 - 知识沉淀”全流程在线化，持续提升研发效率、交付质量与组织协作效率。
        </p>
      </article>

      <article className="panel guide-card">
        <h3>核心流程</h3>
        <ol className="guide-list">
          {workflowSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </article>

      <article className="panel guide-card">
        <h3>角色分工</h3>
        <div className="table">
          <div className="row head guide-row">
            <span>角色</span>
            <span>主要职责</span>
          </div>
          {roleRows.map((item) => (
            <div className="row guide-row" key={item.role}>
              <span>{item.role}</span>
              <span>{item.duty}</span>
            </div>
          ))}
        </div>
      </article>

      <article className="panel guide-card">
        <h3>任务等级与激励范围</h3>
        <div className="table">
          <div className="row head guide-level-row">
            <span>等级</span>
            <span>激励范围</span>
            <span>典型场景</span>
          </div>
          {levelRows.map((item) => (
            <div className="row guide-level-row" key={item.level}>
              <span>{item.level}</span>
              <span>{item.range}</span>
              <span>{item.note}</span>
            </div>
          ))}
        </div>
      </article>

      <article className="panel guide-card">
        <h3>实施原则</h3>
        <ul className="guide-list">
          <li>价值导向：以可验证结果评估贡献，不以岗位层级评判。</li>
          <li>公开透明：任务公开可揭榜，过程留痕、结果可追溯。</li>
          <li>小额高频：优先鼓励可持续的小步快跑改进。</li>
          <li>权限清晰：用户来源以飞书为主，角色由管理员统一分配。</li>
        </ul>
      </article>
    </section>
  )
}
