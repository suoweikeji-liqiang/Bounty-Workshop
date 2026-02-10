import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { useToast } from '../components/ToastProvider'
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

type ProblemFilters = {
  status: string
  scenario: string
  created_from: string
  created_to: string
}
const problemsPageSize = 20

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
  const [page, setPage] = useState(1)
  const [list, setList] = useState<Problem[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const hasNext = useMemo(() => list.length === problemsPageSize, [list.length])

  const attachmentIds = useMemo(
    () =>
      form.attachment_ids_text
        .split(',')
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isInteger(item) && item > 0),
    [form.attachment_ids_text],
  )

  const buildMineQuery = useCallback(() => {
    const params = new URLSearchParams()
    params.set('mine_only', 'true')
    params.set('offset', String((Math.max(page, 1) - 1) * problemsPageSize))
    params.set('limit', String(problemsPageSize))
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
  }, [filters.created_from, filters.created_to, filters.scenario, filters.status, page])

  const loadMine = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await requestJson<Problem[]>(buildMineQuery(), { userId })
      setList(rows)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '鍔犺浇澶辫触')
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
          attachment_ids: attachmentIds,
          attachment_urls: [],
        },
      })
      setMessage('Problem submitted')
      setForm(defaultForm)
      if (page !== 1) {
        setPage(1)
      } else {
        await loadMine()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '鎻愪氦澶辫触')
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
        <h2>闂鎻愪氦</h2>
        <p>鎶婄棝鐐硅浆鍖栦负鍙墽琛屼换鍔★紝鎺ㄥ姩绔嬮」銆</p>
      </header>
      <form className="panel form-grid" onSubmit={submit}>
        <label>
          鏍囬
          <input
            value={form.title}
            maxLength={50}
            onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
            required
          />
        </label>
        <label>
          鍦烘櫙
          <select
            value={form.scenario}
            onChange={(event) => setForm((prev) => ({ ...prev, scenario: event.target.value }))}
          >
            <option value="rd">鐮斿彂</option>
            <option value="ops">杩愮淮</option>
            <option value="delivery">浜や粯</option>
            <option value="support">鏀寔</option>
            <option value="other">鍏朵粬</option>
          </select>
        </label>
        <label>
          棰戠巼
          <select
            value={form.frequency}
            onChange={(event) => setForm((prev) => ({ ...prev, frequency: event.target.value }))}
          >
            <option value="daily">姣忔棩</option>
            <option value="weekly">姣忓懆</option>
            <option value="monthly">姣忔湀</option>
            <option value="quarterly">瀛ｅ害</option>
            <option value="occasional">鍋跺彂</option>
          </select>
        </label>
        <label>
          褰卞搷鑼冨洿
          <select
            value={form.impact_scope}
            onChange={(event) => setForm((prev) => ({ ...prev, impact_scope: event.target.value }))}
          >
            <option value="individual">涓汉</option>
            <option value="team">鍥㈤槦</option>
            <option value="department">閮ㄩ棬</option>
            <option value="company">鍏徃</option>
          </select>
        </label>
        <label className="wide">
          鑳屾櫙
          <textarea
            value={form.background}
            onChange={(event) => setForm((prev) => ({ ...prev, background: event.target.value }))}
            required
          />
        </label>
        <label className="wide">
          闂鎻忚堪
          <textarea
            value={form.description}
            onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
            required
          />
        </label>
        <label className="wide">
          浠峰€艰鏄?
          <textarea
            value={form.value_statement}
            onChange={(event) => setForm((prev) => ({ ...prev, value_statement: event.target.value }))}
            required
          />
        </label>
        <label className="wide">
          闄勪欢 ID锛堥€楀彿鍒嗛殧锛?
          <input
            value={form.attachment_ids_text}
            onChange={(event) => setForm((prev) => ({ ...prev, attachment_ids_text: event.target.value }))}
            placeholder="渚嬪: 1,2,3"
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
            闄嶄綆浜哄姏鏃堕棿
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
            闄嶄綆鎴愭湰杩斿伐
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
            鏀瑰杽绋冲畾璐ㄩ噺
          </label>
        </div>
        <button className="primary-btn" type="submit">
          鎻愪氦闂
        </button>
      </form>
      <form
        className="panel form-grid"
        onSubmit={(event) => {
          event.preventDefault()
          if (page !== 1) {
            setPage(1)
            return
          }
          void loadMine()
        }}
      >
        <h3>鎴戠殑闂绛涢€</h3>
        <label>
          鐘舵€?
          <select
            value={filters.status}
            onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
          >
            <option value="">鍏ㄩ儴</option>
            <option value="pending_review">寰呭鏍</option>
            <option value="approved">宸茬珛椤</option>
            <option value="rejected">涓嶇珛椤</option>
            <option value="archived">宸插綊妗</option>
          </select>
        </label>
        <label>
          鍦烘櫙
          <select
            value={filters.scenario}
            onChange={(event) => setFilters((prev) => ({ ...prev, scenario: event.target.value }))}
          >
            <option value="">鍏ㄩ儴</option>
            <option value="rd">鐮斿彂</option>
            <option value="ops">杩愮淮</option>
            <option value="delivery">浜や粯</option>
            <option value="support">鏀寔</option>
            <option value="other">鍏朵粬</option>
          </select>
        </label>
        <label>
          璧峰鏃ユ湡
          <input
            type="date"
            value={filters.created_from}
            onChange={(event) => setFilters((prev) => ({ ...prev, created_from: event.target.value }))}
          />
        </label>
        <label>
          鎴鏃ユ湡
          <input
            type="date"
            value={filters.created_to}
            onChange={(event) => setFilters((prev) => ({ ...prev, created_to: event.target.value }))}
          />
        </label>
        <div className="button-row wide">
          <button className="primary-btn" type="submit" disabled={loading}>
            绛涢€?
          </button>
          <button
            type="button"
            onClick={() => {
              setFilters(defaultFilters)
              setPage(1)
            }}
            disabled={loading}
          >
            閲嶇疆
          </button>
        </div>
      </form>
      <article className="panel">
        <div className="panel-headline">
          <h3>鎴戠殑闂</h3>
          <button type="button" onClick={() => void loadMine()} disabled={loading}>
            鍒锋柊
          </button>
        </div>
        <div className="table">
          <div className="row head">
            <span>ID</span>
            <span>鏍囬</span>
            <span>鍦烘櫙</span>
            <span>鐘舵€</span>
            <span>鏃堕棿</span>
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
        <div className="button-row">
          <button type="button" onClick={() => setPage((prev) => Math.max(prev - 1, 1))} disabled={page <= 1 || loading}>
            涓婁竴椤?          </button>
          <span className="muted">绗?{page} 椤</span>
          <button type="button" onClick={() => setPage((prev) => prev + 1)} disabled={!hasNext || loading}>
            涓嬩竴椤?          </button>
        </div>
      </article>
    </section>
  )
}

