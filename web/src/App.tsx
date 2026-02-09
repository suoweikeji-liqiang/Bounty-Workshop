import type { ReactElement } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'

import { apiBaseUrl } from './lib/http'
import { AttachmentsPage } from './pages/AttachmentsPage'
import { DashboardPage } from './pages/DashboardPage'
import { ExecutionLoopPage } from './pages/ExecutionLoopPage'
import { FeishuPage } from './pages/FeishuPage'
import { KnowledgePage } from './pages/KnowledgePage'
import { PersonalCenterPage } from './pages/PersonalCenterPage'
import { ProblemsPage } from './pages/ProblemsPage'
import { ReviewWorkbenchPage } from './pages/ReviewWorkbenchPage'
import { TaskHallPage } from './pages/TaskHallPage'
import { UsersPage } from './pages/UsersPage'
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
        <h2>Permission denied</h2>
        <p>The current account does not have permission to access this page.</p>
      </header>
    </section>
  )
}

function TopBar({ userId, setUserId, profile, loadingProfile, profileError }: Props) {
  return (
    <header className="topbar">
      <div>
        <p className="kicker">Bounty Workshop</p>
        <h1>Bounty Task Console</h1>
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
        {loadingProfile && <p className="muted">Loading user profile...</p>}
        {profile && (
          <p className="muted">
            {profile.name} ({profile.roles.join(', ')})
          </p>
        )}
        {profileError && <p className="error-text">{profileError}</p>}
      </div>
    </header>
  )
}

export default function App(props: Props) {
  const { userId, profile } = props
  const isAdmin = hasAnyRole(profile, ['admin'])
  const canReviewOrAdmin = hasAnyRole(profile, ['admin', 'reviewer'])
  const canAcceptOrAdmin = hasAnyRole(profile, ['admin', 'acceptor'])

  return (
    <div className="app-shell">
      <TopBar {...props} />
      <div className="content-shell">
        <aside className="sidenav">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/personal">Personal</NavLink>
          <NavLink to="/problems">Problems</NavLink>
          {(canReviewOrAdmin || isAdmin) && <NavLink to="/review">Review</NavLink>}
          <NavLink to="/tasks">Task Hall</NavLink>
          <NavLink to="/execution">Execution</NavLink>
          <NavLink to="/knowledge">Knowledge</NavLink>
          <NavLink to="/attachments">Attachments</NavLink>
          {isAdmin && <NavLink to="/users">Users</NavLink>}
          {(canReviewOrAdmin || canAcceptOrAdmin) && <NavLink to="/feishu">Feishu</NavLink>}
        </aside>
        <main className="main-area">
          <Routes>
            <Route path="/" element={<DashboardPage userId={userId} />} />
            <Route path="/personal" element={<PersonalCenterPage userId={userId} />} />
            <Route path="/problems" element={<ProblemsPage userId={userId} />} />
            <Route
              path="/review"
              element={
                <Guard profile={profile} roles={['admin', 'reviewer']}>
                  <ReviewWorkbenchPage userId={userId} />
                </Guard>
              }
            />
            <Route path="/tasks" element={<TaskHallPage userId={userId} profile={profile} />} />
            <Route path="/execution" element={<ExecutionLoopPage userId={userId} profile={profile} />} />
            <Route path="/knowledge" element={<KnowledgePage userId={userId} />} />
            <Route path="/attachments" element={<AttachmentsPage userId={userId} />} />
            <Route
              path="/users"
              element={
                <Guard profile={profile} roles={['admin']}>
                  <UsersPage userId={userId} />
                </Guard>
              }
            />
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
