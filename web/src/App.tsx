import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import type { ReactElement } from 'react'

import { apiBaseUrl } from './lib/http'
import { AttachmentsPage } from './pages/AttachmentsPage'
import { DashboardPage } from './pages/DashboardPage'
import { ExecutionLoopPage } from './pages/ExecutionLoopPage'
import { FeishuPage } from './pages/FeishuPage'
import { ProblemsPage } from './pages/ProblemsPage'
import { TaskHallPage } from './pages/TaskHallPage'
import type { UserProfile } from './types'

type Props = {
  userId: number
  setUserId: (value: number) => void
  profile: UserProfile | null
  loadingProfile: boolean
  profileError: string | null
}

type GuardProps = {
  profile: UserProfile | null
  roles: string[]
  children: ReactElement
}

function hasAnyRole(profile: UserProfile | null, allowedRoles: string[]) {
  if (!profile) {
    return false
  }
  return profile.roles.some((role) => allowedRoles.includes(role))
}

function Guard({ profile, roles, children }: GuardProps) {
  if (hasAnyRole(profile, roles)) {
    return children
  }
  return (
    <section className="page-wrap">
      <header className="page-head">
        <h2>权限不足</h2>
        <p>当前账号没有访问该页面的角色。</p>
      </header>
    </section>
  )
}

function TopBar({ userId, setUserId, profile, loadingProfile, profileError }: Props) {
  return (
    <header className="topbar">
      <div>
        <p className="kicker">Bounty Workshop</p>
        <h1>揭榜挂帅前端控制台</h1>
      </div>
      <div className="topbar-controls">
        <p className="muted">API: {apiBaseUrl}</p>
        <label>
          X-User-Id
          <input
            type="number"
            value={userId}
            onChange={(event) => setUserId(Number(event.target.value) || 1)}
            min={1}
          />
        </label>
        {loadingProfile && <p className="muted">读取用户中...</p>}
        {profile && (
          <p className="muted">
            {profile.name}（{profile.roles.join(', ')}）
          </p>
        )}
        {profileError && <p className="error-text">{profileError}</p>}
      </div>
    </header>
  )
}

export default function App(props: Props) {
  const { userId, profile } = props
  const canReviewOrAdmin = hasAnyRole(profile, ['admin', 'reviewer'])
  const canAcceptOrAdmin = hasAnyRole(profile, ['admin', 'acceptor'])

  return (
    <div className="app-shell">
      <TopBar {...props} />
      <div className="content-shell">
        <aside className="sidenav">
          <NavLink to="/" end>
            仪表盘
          </NavLink>
          <NavLink to="/problems">问题池</NavLink>
          <NavLink to="/tasks">任务大厅</NavLink>
          <NavLink to="/execution">执行闭环</NavLink>
          <NavLink to="/attachments">附件中心</NavLink>
          {(canReviewOrAdmin || canAcceptOrAdmin) && <NavLink to="/feishu">飞书集成</NavLink>}
        </aside>
        <main className="main-area">
          <Routes>
            <Route path="/" element={<DashboardPage userId={userId} />} />
            <Route path="/problems" element={<ProblemsPage userId={userId} />} />
            <Route path="/tasks" element={<TaskHallPage userId={userId} />} />
            <Route path="/execution" element={<ExecutionLoopPage userId={userId} profile={profile} />} />
            <Route path="/attachments" element={<AttachmentsPage userId={userId} />} />
            <Route
              path="/feishu"
              element={
                <Guard profile={profile} roles={['admin', 'reviewer', 'acceptor']}>
                  <FeishuPage userId={userId} profile={profile} />
                </Guard>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
