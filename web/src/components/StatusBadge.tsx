import type { ReactNode } from 'react'

type Tone = 'success' | 'warn' | 'danger' | 'info' | 'muted'

type Props = {
  tone: Tone
  children: ReactNode
}

function cls(tone: Tone): string {
  if (tone === 'success') return 'status-badge is-success'
  if (tone === 'warn') return 'status-badge is-warn'
  if (tone === 'danger') return 'status-badge is-danger'
  if (tone === 'info') return 'status-badge is-info'
  return 'status-badge is-muted'
}

export function StatusBadge({ tone, children }: Props) {
  return <span className={cls(tone)}>{children}</span>
}
