import type { ReactElement } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'

import { AIModelConfigPage } from './pages/AIModelConfigPage'
import { AttachmentsPage } from './pages/AttachmentsPage'
import { ChangePasswordPage } from './pages/ChangePasswordPage'
import { ClaimApprovalPage } from './pages/ClaimApprovalPage'
import { DashboardPage } from './pages/DashboardPage'
import { ExecutionLoopPage } from './pages/ExecutionLoopPage'
import { FeishuPage } from './pages/FeishuPage'
import { HypothesisVerificationPage } from './pages/HypothesisVerificationPage'
import { KnowledgePage } from './pages/KnowledgePage'
import { OperationLogsPage } from './pages/OperationLogsPage'
import { PersonalCenterPage } from './pages/PersonalCenterPage'
import { ProblemsPage } from './pages/ProblemsPage'
import { ReviewWorkbenchPage } from './pages/ReviewWorkbenchPage'
import { SystemConfigPage } from './pages/SystemConfigPage'
import { SystemGuidePage } from './pages/SystemGuidePage'
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
        <h2>无权限访问</h2>
        <p>当前账号没有访问该页面的权限。</p>
      </header>
    </section>
  )
}

function TopBar({ onLogout }: Pick<Props, 'onLogout'>) {
  return (
    <header className="topbar">
      <div>
        <p className="kicker">揭榜挂帅工坊</p>
        <h1>任务协作控制台</h1>
      </div>
      <div className="topbar-controls">
        <button type="button" onClick={onLogout}>
          退出登录
        </button>
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
      <TopBar onLogout={props.onLogout} />
      <div className="content-shell">
        <aside className="sidenav">
          <p className="sidenav-group-title">业务操作</p>
          <NavLink to="/" end>
            看板
          </NavLink>
          <NavLink to="/problems">问题提报</NavLink>
          {(canReviewOrAdmin || isAdmin) && <NavLink to="/review">审核工作台</NavLink>}
          <NavLink to="/tasks">任务大厅</NavLink>
          <NavLink to="/claim-approvals">揭榜审批</NavLink>
          <NavLink to="/execution">执行闭环</NavLink>
          <NavLink to="/knowledge">知识库</NavLink>

          <p className="sidenav-group-title">个人操作</p>
          <NavLink to="/personal">个人中心</NavLink>
          <NavLink to="/change-password">修改密码</NavLink>

          <p className="sidenav-group-title">设置操作</p>
          {canReviewOrAdmin && <NavLink to="/operation-logs">操作日志</NavLink>}
          {canReviewOrAdmin && <NavLink to="/hypothesis">假设验证</NavLink>}
          {(canReviewOrAdmin || canAcceptOrAdmin) && <NavLink to="/feishu">飞书集成</NavLink>}
          {isAdmin && <NavLink to="/ai-models">AI 模型</NavLink>}
          {isAdmin && <NavLink to="/users">角色分配</NavLink>}
          {isAdmin && <NavLink to="/system-config">系统配置</NavLink>}

          <p className="sidenav-group-title">帮助与工具</p>
          <NavLink to="/guide">系统说明</NavLink>
          <NavLink to="/attachments">附件中心</NavLink>
        </aside>
        <main className="main-area">
          <Routes>
            <Route path="/" element={<DashboardPage userId={userId} />} />
            <Route path="/personal" element={<PersonalCenterPage userId={userId} />} />
            <Route path="/change-password" element={<ChangePasswordPage />} />
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
            <Route
              path="/claim-approvals"
              element={<ClaimApprovalPage userId={userId} profile={profile} />}
            />
            <Route path="/execution" element={<ExecutionLoopPage userId={userId} profile={profile} />} />
            <Route path="/knowledge" element={<KnowledgePage userId={userId} />} />
            <Route path="/guide" element={<SystemGuidePage />} />
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
            <Route
              path="/ai-models"
              element={
                <Guard profile={profile} roles={['admin']}>
                  <AIModelConfigPage userId={userId} />
                </Guard>
              }
            />
            <Route
              path="/hypothesis"
              element={
                <Guard profile={profile} roles={['admin', 'reviewer']}>
                  <HypothesisVerificationPage userId={userId} />
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
