import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { requestJson } from '../lib/http'
import type { Problem } from '../types'

type Props = {
  userId: number
}

type ProblemForm = {
  title: string
  scenario: string
  background: string
  frequency: string
  impact_scope: string
  description: string
  value_reduce_effort: boolean
  value_reduce_cost: boolean
  value_improve_quality: boolean
  value_statement: string
  attachment_ids_text: string
}

const defaultForm: ProblemForm = {
  title: '',
  scenario: 'rd',
  background: '',
  frequency: 'weekly',
  impact_scope: 'team',
  description: '',
  value_reduce_effort: true,
  value_reduce_cost: false,
  value_improve_quality: false,
  value_statement: '',
  attachment_ids_text: '',
}

export function ProblemsPage({ userId }: Props) {
  const [form, setForm] = useState<ProblemForm>(defaultForm)
  const [list, setList] = useState<Problem[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const attachmentIds = useMemo(
    () =>
      form.attachment_ids_text
        .split(',')
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isInteger(item) && item > 0),
    [form.attachment_ids_text],
  )

  const loadMine = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await requestJson<Problem[]>('/problems?mine_only=true', { userId })
      setList(rows)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void loadMine()
  }, [loadMine])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      setMessage(null)
      setError(null)
      await requestJson('/problems', {
        method: 'POST',
        userId,
        body: {
          ...form,
          attachment_ids: attachmentIds,
          attachment_urls: [],
        },
      })
      setMessage('问题已提交')
      setForm(defaultForm)
      await loadMine()
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败')
    }
  }

  return (
    <section className="page-wrap">
      <header className="page-head">
        <h2>问题提交</h2>
        <p>把痛点转化为可执行任务，推动立项。</p>
      </header>
      <form className="panel form-grid" onSubmit={submit}>
        <label>
          标题
          <input
            value={form.title}
            maxLength={50}
            onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
            required
          />
        </label>
        <label>
          场景
          <select
            value={form.scenario}
            onChange={(event) => setForm((prev) => ({ ...prev, scenario: event.target.value }))}
          >
            <option value="rd">研发</option>
            <option value="ops">运维</option>
            <option value="delivery">交付</option>
            <option value="support">支持</option>
            <option value="other">其他</option>
          </select>
        </label>
        <label>
          频率
          <select
            value={form.frequency}
            onChange={(event) => setForm((prev) => ({ ...prev, frequency: event.target.value }))}
          >
            <option value="daily">每日</option>
            <option value="weekly">每周</option>
            <option value="monthly">每月</option>
            <option value="quarterly">季度</option>
            <option value="occasional">偶发</option>
          </select>
        </label>
        <label>
          影响范围
          <select
            value={form.impact_scope}
            onChange={(event) => setForm((prev) => ({ ...prev, impact_scope: event.target.value }))}
          >
            <option value="individual">个人</option>
            <option value="team">团队</option>
            <option value="department">部门</option>
            <option value="company">公司</option>
          </select>
        </label>
        <label className="wide">
          背景
          <textarea
            value={form.background}
            onChange={(event) => setForm((prev) => ({ ...prev, background: event.target.value }))}
            required
          />
        </label>
        <label className="wide">
          问题描述
          <textarea
            value={form.description}
            onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
            required
          />
        </label>
        <label className="wide">
          价值说明
          <textarea
            value={form.value_statement}
            onChange={(event) => setForm((prev) => ({ ...prev, value_statement: event.target.value }))}
            required
          />
        </label>
        <label className="wide">
          附件 ID（逗号分隔）
          <input
            value={form.attachment_ids_text}
            onChange={(event) => setForm((prev) => ({ ...prev, attachment_ids_text: event.target.value }))}
            placeholder="例如: 1,2,3"
          />
        </label>
        <div className="wide checks">
          <label>
            <input
              type="checkbox"
              checked={form.value_reduce_effort}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  value_reduce_effort: event.target.checked,
                }))
              }
            />
            降低人力时间
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.value_reduce_cost}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  value_reduce_cost: event.target.checked,
                }))
              }
            />
            降低成本返工
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.value_improve_quality}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  value_improve_quality: event.target.checked,
                }))
              }
            />
            改善稳定质量
          </label>
        </div>
        <button className="primary-btn" type="submit">
          提交问题
        </button>
      </form>
      {message && <p className="ok-text">{message}</p>}
      {error && <p className="error-text">{error}</p>}
      <article className="panel">
        <div className="panel-headline">
          <h3>我的问题</h3>
          <button type="button" onClick={() => void loadMine()} disabled={loading}>
            刷新
          </button>
        </div>
        <div className="table">
          <div className="row head">
            <span>ID</span>
            <span>标题</span>
            <span>场景</span>
            <span>状态</span>
            <span>时间</span>
          </div>
          {list.map((item) => (
            <div className="row" key={item.id}>
              <span>#{item.id}</span>
              <span>{item.title}</span>
              <span>{item.scenario}</span>
              <span>{item.status}</span>
              <span>{new Date(item.created_at).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      </article>
    </section>
  )
}
