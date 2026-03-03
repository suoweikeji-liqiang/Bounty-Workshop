export type RoleName = 'admin' | 'reviewer' | 'reward_approver' | 'acceptor' | 'employee'

export const allRoles: RoleName[] = ['admin', 'reviewer', 'reward_approver', 'acceptor', 'employee']

export function toggleRole(current: RoleName[], role: RoleName): RoleName[] {
  if (current.includes(role)) {
    const next = current.filter((item) => item !== role) as RoleName[]
    return next.length > 0 ? next : ['employee']
  }
  return [...current, role] as RoleName[]
}

export function normalizeRoles(roles: string[]): RoleName[] {
  const next = roles.filter((role): role is RoleName => allRoles.includes(role as RoleName))
  return next.length > 0 ? next : ['employee']
}

export function roleLabel(role: RoleName) {
  if (role === 'admin') return '管理员'
  if (role === 'reviewer') return '评审'
  if (role === 'acceptor') return '验收人'
  if (role === 'reward_approver') return '资金复核'
  return '员工'
}

export function statusLabel(status: string) {
  if (status === 'enabled') return '启用'
  if (status === 'disabled') return '禁用'
  return status
}

export function statusTone(status: string): 'success' | 'warn' | 'danger' | 'info' | 'muted' {
  if (status === 'enabled') return 'success'
  if (status === 'disabled') return 'danger'
  return 'muted'
}
