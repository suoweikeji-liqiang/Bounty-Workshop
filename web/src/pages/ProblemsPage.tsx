import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import { AttachmentField } from '../components/AttachmentField'
import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import type { Attachment, Problem } from '../types'

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
}

type ProblemFilters = {
  status: string
  scenario: string
  created_from: string
  created_to: string
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
}

const defaultFilters: ProblemFilters = {
  status: '',
  scenario: '',
  created_from: '',
  created_to: '',
}

export function ProblemsPage({ userId }: Props) {
  const toast = useToast()
  const [form, setForm] = useState<ProblemForm>(defaultForm)
  const [filters, setFilters] = useState<ProblemFilters>(defaultFilters)
  const [list, setList] = useState<Problem[]>([])
  const [uploadedAttachments, setUploadedAttachments] = useState<Attachment[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleUploadedAttachmentsChange = (next: Attachment[]) => {
    setUploadedAttachments(next)
  }

  const buildMineQuery = useCallback(() => {
    const params = new URLSearchParams()
    params.set('mine_only', 'true')
    if (filters.status) {
      params.set('status', filters.status)
    }
    if (filters.scenario) {
      params.set('scenario', filters.scenario)
    }
    if (filters.created_from) {
      params.set('created_from', filters.created_from)
    }
    if (filters.created_to) {
      params.set('created_to', filters.created_to)
    }
    return `/problems?${params.toString()}`
  }, [filters.created_from, filters.created_to, filters.scenario, filters.status])

  const loadMine = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await requestJson<Problem[]>(buildMineQuery(), { userId })
      setList(rows)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [userId, buildMineQuery])

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
          attachment_ids: uploadedAttachments.map((item) => item.id),
          attachment_urls: [],
        },
      })
      setMessage('问题已提交')
      setForm(defaultForm)
      setUploadedAttachments([])
      await loadMine()
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败')
    }
  }

  useEffect(() => {
    if (!message) {
      return
    }
    toast.success(message)
  }, [message, toast])

  useEffect(() => {
    if (!error) {
      return
    }
    toast.error(error)
  }, [error, toast])

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
        <AttachmentField
          userId={userId}
          value={uploadedAttachments}
          onChange={handleUploadedAttachmentsChange}
          label="附件上传"
        />
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
      <form
        className="panel form-grid"
        onSubmit={(event) => {
          event.preventDefault()
          void loadMine()
        }}
      >
        <h3>我的问题筛选</h3>
        <label>
          状态
          <select
            value={filters.status}
            onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
          >
            <option value="">全部</option>
            <option value="pending_review">待审核</option>
            <option value="approved">已立项</option>
            <option value="rejected">不立项</option>
            <option value="archived">已归档</option>
          </select>
        </label>
        <label>
          场景
          <select
            value={filters.scenario}
            onChange={(event) => setFilters((prev) => ({ ...prev, scenario: event.target.value }))}
          >
            <option value="">全部</option>
            <option value="rd">研发</option>
            <option value="ops">运维</option>
            <option value="delivery">交付</option>
            <option value="support">支持</option>
            <option value="other">其他</option>
          </select>
        </label>
        <label>
          起始日期
          <input
            type="date"
            value={filters.created_from}
            onChange={(event) => setFilters((prev) => ({ ...prev, created_from: event.target.value }))}
          />
        </label>
        <label>
          截止日期
          <input
            type="date"
            value={filters.created_to}
            onChange={(event) => setFilters((prev) => ({ ...prev, created_to: event.target.value }))}
          />
        </label>
        <div className="button-row wide">
          <button className="primary-btn" type="submit" disabled={loading}>
            筛选
          </button>
          <button
            type="button"
            onClick={() => {
              setFilters(defaultFilters)
            }}
            disabled={loading}
          >
            重置
          </button>
        </div>
      </form>
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
