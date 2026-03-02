export function formatScenarioLabel(scenario?: string | null): string {
  if (!scenario) return '-'
  const map: Record<string, string> = {
    rd: '研发',
    ops: '运维',
    delivery: '交付',
    support: '支持',
    other: '其他',
  }
  return map[scenario] ?? scenario
}

export function formatProblemStatusLabel(status?: string | null): string {
  if (!status) return '-'
  const map: Record<string, string> = {
    draft: '草稿',
    pending_review: '待评审',
    pricing_revision_required: '待重新定价',
    budget_pending: '待资金复核',
    approved: '已立项',
    rejected: '不立项',
    archived: '已归档',
  }
  return map[status] ?? status
}

export function formatProblemFrequencyLabel(frequency?: string | null): string {
  if (!frequency) return '-'
  const map: Record<string, string> = {
    daily: '每日',
    weekly: '每周',
    monthly: '每月',
    quarterly: '季度',
    occasional: '偶发',
  }
  return map[frequency] ?? frequency
}

export function formatImpactScopeLabel(scope?: string | null): string {
  if (!scope) return '-'
  const map: Record<string, string> = {
    individual: '个人',
    team: '团队',
    department: '部门',
    company: '公司',
  }
  return map[scope] ?? scope
}
