import type { ReactElement } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'

import { apiBaseUrl } from './lib/http'
import { hasAnyRole } from './lib/roles'
import { AttachmentsPage } from './pages/AttachmentsPage'
import { ClaimApprovalPage } from './pages/ClaimApprovalPage'
import { DashboardPage } from './pages/DashboardPage'
import { ExecutionLoopPage } from './pages/ExecutionLoopPage'
import { FeishuPage } from './pages/FeishuPage'
import { KnowledgePage } from './pages/KnowledgePage'
import { OperationLogsPage } from './pages/OperationLogsPage'
import { PersonalCenterPage } from './pages/PersonalCenterPage'
import { ProblemsPage } from './pages/ProblemsPage'
import { RewardReviewPage } from './pages/RewardReviewPage'
import { ReviewWorkbenchPage } from './pages/ReviewWorkbenchPage'
import { SystemConfigPage } from './pages/SystemConfigPage'
import { TaskHallPage } from './pages/TaskHallPage'
import { UsersPage } from './pages/UsersPage'
import type { UserProfile } from './types'

type Props = {
  userId: number
  profile: UserProfile | null
  loadingProfile: boolean
  onLogout: () => void
}

type GuardProps = {
  profile: UserProfile | null
  roles: string[]
  children: ReactElement
}

function Guard({ profile, roles, children }: GuardProps) {
  if (hasAnyRole(profile, roles)) {
    return children
  }
  return (
    <section className="page-wrap">
      <header className="page-head">
        <h2>无权限访问</h2>
        <p>当前账号没有访问该页面的权限。</p>
      </header>
    </section>
  )
}

function TopBar({ profile, loadingProfile, onLogout }: Props) {
  return (
    <header className="topbar">
      <div>
        <p className="kicker">揭榜挂帅工坊</p>
        <h1>任务协作控制台</h1>
      </div>
      <div className="topbar-controls">
        <p className="muted">接口地址：{apiBaseUrl}</p>
        {loadingProfile && <p className="muted">正在加载用户信息...</p>}
        {profile && (
          <p className="muted">
            #{profile.id} {profile.name} ({profile.roles.join(', ')})
          </p>
        )}
        <button type="button" onClick={onLogout}>退出登录</button>
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
            看板
          </NavLink>
          <NavLink to="/personal">个人中心</NavLink>
          <NavLink to="/problems">问题提报</NavLink>
          {(canReviewOrAdmin || isAdmin) && <NavLink to="/review">审核工作台</NavLink>}
          <NavLink to="/tasks">任务大厅</NavLink>
          <NavLink to="/claim-approvals">揭榜审批</NavLink>
          <NavLink to="/execution">执行闭环</NavLink>
          {canReviewOrAdmin && <NavLink to="/reward-review">激励复核</NavLink>}
          <NavLink to="/knowledge">知识库</NavLink>
          <NavLink to="/attachments">附件中心</NavLink>
          {canReviewOrAdmin && <NavLink to="/operation-logs">操作日志</NavLink>}
          {isAdmin && <NavLink to="/system-config">系统配置</NavLink>}
          {isAdmin && <NavLink to="/users">用户管理</NavLink>}
          {(canReviewOrAdmin || canAcceptOrAdmin) && <NavLink to="/feishu">飞书集成</NavLink>}
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
            <Route path="/claim-approvals" element={<ClaimApprovalPage userId={userId} profile={profile} />} />
            <Route path="/execution" element={<ExecutionLoopPage userId={userId} profile={profile} />} />
            <Route
              path="/reward-review"
              element={
                <Guard profile={profile} roles={['admin', 'reviewer']}>
                  <RewardReviewPage userId={userId} profile={profile} />
                </Guard>
              }
            />
            <Route path="/knowledge" element={<KnowledgePage userId={userId} />} />
            <Route path="/attachments" element={<AttachmentsPage userId={userId} />} />
            <Route
              path="/operation-logs"
              element={
                <Guard profile={profile} roles={['admin', 'reviewer']}>
                  <OperationLogsPage userId={userId} />
                </Guard>
              }
            />
            <Route
              path="/system-config"
              element={
                <Guard profile={profile} roles={['admin']}>
                  <SystemConfigPage userId={userId} />
                </Guard>
              }
            />
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
