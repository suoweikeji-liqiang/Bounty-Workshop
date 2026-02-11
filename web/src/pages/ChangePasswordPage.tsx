import { useState } from 'react'
import type { FormEvent } from 'react'
import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'

export function ChangePasswordPage() {
  const toast = useToast()
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()

    // 前端验证
    if (newPassword !== confirmPassword) {
      toast.error('两次输入的新密码不一致')
      return
    }

    if (newPassword.length < 8) {
      toast.error('密码至少需要8位')
      return
    }

    if (oldPassword === newPassword) {
      toast.error('新密码不能与旧密码相同')
      return
    }

    try {
      setLoading(true)
      await requestJson('/me/password', {
        method: 'POST',
        body: {
          old_password: oldPassword,
          new_password: newPassword,
        },
      })

      toast.success('密码修改成功！')
      
      // 清空表单
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '修改密码失败')
    } finally {
      setLoading(false)
    }
  }

  const getPasswordStrength = (password: string): { label: string; color: string } => {
    if (password.length < 8) {
      return { label: '弱', color: '#ef4444' }
    }

    let strength = 0
    if (/[a-z]/.test(password)) strength++
    if (/[A-Z]/.test(password)) strength++
    if (/[0-9]/.test(password)) strength++
    if (/[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.test(password)) strength++

    if (strength >= 4) return { label: '强', color: '#10b981' }
    if (strength >= 3) return { label: '中', color: '#f59e0b' }
    return { label: '弱', color: '#ef4444' }
  }

  const strength = newPassword ? getPasswordStrength(newPassword) : null

  return (
    <section className="page-wrap">
      <header className="page-head">
        <div>
          <h2>修改密码</h2>
          <p>为了账号安全，建议定期修改密码</p>
        </div>
      </header>

      <div className="panel" style={{ maxWidth: '600px' }}>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label className="wide">
            当前密码
            <input
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              placeholder="请输入当前密码"
              required
              minLength={6}
            />
          </label>

          <label className="wide">
            新密码
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="至少8位，包含大小写字母、数字、特殊字符"
              required
              minLength={8}
            />
            {strength && (
              <div style={{ marginTop: '8px', fontSize: '13px' }}>
                密码强度：
                <span style={{ color: strength.color, fontWeight: '600' }}>
                  {strength.label}
                </span>
              </div>
            )}
          </label>

          <label className="wide">
            确认新密码
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="再次输入新密码"
              required
              minLength={8}
            />
          </label>

          <div className="wide" style={{ marginTop: '8px' }}>
            <p className="muted" style={{ fontSize: '13px', lineHeight: '1.6' }}>
              密码要求：
              <br />
              • 至少8位字符
              <br />
              • 必须包含大小写字母、数字、特殊字符中的至少3种
              <br />
              • 不能与旧密码相同
              <br />• 密码将在90天后过期，届时需要重新设置
            </p>
          </div>

          <div className="button-row wide">
            <button type="submit" className="primary-btn" disabled={loading}>
              {loading ? '修改中...' : '确认修改'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOldPassword('')
                setNewPassword('')
                setConfirmPassword('')
              }}
              disabled={loading}
            >
              重置
            </button>
          </div>
        </form>
      </div>
    </section>
  )
}
