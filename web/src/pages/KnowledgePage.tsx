import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import type { KnowledgeItem } from '../types'

type Props = {
  userId: number
}

type FilterState = {
  keyword: string
  scenario: string
  level: string
  recommended: 'all' | 'true' | 'false'
}

const defaultFilters: FilterState = {
  keyword: '',
  scenario: '',
  level: '',
  recommended: 'all',
}

const pageSize = 20

function buildQuery(filters: FilterState, page: number): string {
  const params = new URLSearchParams()
  if (filters.keyword.trim()) {
    params.set('keyword', filters.keyword.trim())
  }
  if (filters.scenario) {
    params.set('scenario', filters.scenario)
  }
  if (filters.level) {
    params.set('level', filters.level)
  }
  if (filters.recommended !== 'all') {
    params.set('recommended', filters.recommended)
  }
  params.set('offset', String((Math.max(page, 1) - 1) * pageSize))
  params.set('limit', String(pageSize))
  return `?${params.toString()}`
}

export function KnowledgePage({ userId }: Props) {
  const toast = useToast()
  const [filters, setFilters] = useState<FilterState>(defaultFilters)
  const [rows, setRows] = useState<KnowledgeItem[]>([])
  const [detail, setDetail] = useState<KnowledgeItem | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasNext = useMemo(() => rows.length === pageSize, [rows.length])

  const load = useCallback(
    async (nextFilters: FilterState, nextPage: number) => {
      setLoading(true)
      try {
        setError(null)
        const data = await requestJson<KnowledgeItem[]>(
          `/knowledge${buildQuery(nextFilters, nextPage)}`,
          { userId },
        )
        setRows(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed to load knowledge items')
      } finally {
        setLoading(false)
      }
    },
    [userId],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load(filters, page)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [filters, page, load])

  useEffect(() => {
    if (!detailOpen) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDetailOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [detailOpen])

  const submitFilters = async (event: FormEvent) => {
    event.preventDefault()
    if (page !== 1) {
      setPage(1)
      return
    }
    await load(filters, 1)
  }

  const resetFilters = async () => {
    setFilters(defaultFilters)
    setPage(1)
    await load(defaultFilters, 1)
  }

  const openDetail = async (knowledgeId: number) => {
    try {
      setError(null)
      const payload = await requestJson<KnowledgeItem>(`/knowledge/${knowledgeId}`, { userId })
      setDetail(payload)
      setDetailOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load knowledge detail')
    }
  }

  useEffect(() => {
    if (!error) {
      return
    }
    toast.error(error)
  }, [error, toast])

  return (
    <section className="page-wrap">
      <header className="page-head">
        <h2>Knowledge Hub</h2>
        <p>Lightweight archive with server-side filter and pagination.</p>
      </header>

      <form className="panel form-grid" onSubmit={submitFilters}>
        <h3>Filters</h3>
        <label>
          keyword
          <input
            value={filters.keyword}
            onChange={(event) => setFilters((prev) => ({ ...prev, keyword: event.target.value }))}
            placeholder="problem summary, solution or tags"
          />
        </label>
        <label>
          scenario
          <select
            value={filters.scenario}
            onChange={(event) => setFilters((prev) => ({ ...prev, scenario: event.target.value }))}
          >
            <option value="">all</option>
            <option value="rd">rd</option>
            <option value="ops">ops</option>
            <option value="delivery">delivery</option>
            <option value="support">support</option>
            <option value="other">other</option>
          </select>
        </label>
        <label>
          level
          <select
            value={filters.level}
            onChange={(event) => setFilters((prev) => ({ ...prev, level: event.target.value }))}
          >
            <option value="">all</option>
            <option value="S">S</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
        </label>
        <label>
          recommended
          <select
            value={filters.recommended}
            onChange={(event) =>
              setFilters((prev) => ({ ...prev, recommended: event.target.value as FilterState['recommended'] }))
            }
          >
            <option value="all">all</option>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </label>
        <div className="button-row wide">
          <button className="primary-btn" type="submit" disabled={loading}>
            {loading ? 'querying...' : 'query'}
          </button>
          <button type="button" onClick={() => void resetFilters()} disabled={loading}>
            reset
          </button>
        </div>
      </form>

      <article className="panel">
        <div className="panel-headline">
          <h3>Knowledge Items (page {page})</h3>
          <button type="button" onClick={() => void load(filters, page)} disabled={loading}>
            refresh
          </button>
        </div>
        <div className="button-row">
          <button type="button" onClick={() => setPage((prev) => Math.max(prev - 1, 1))} disabled={page <= 1 || loading}>
            prev
          </button>
          <button type="button" onClick={() => setPage((prev) => prev + 1)} disabled={!hasNext || loading}>
            next
          </button>
        </div>
        <div className="table">
          <div className="row head wide-row">
            <span>ID</span>
            <span>task</span>
            <span>scenario/level</span>
            <span>recommended</span>
            <span>archived at</span>
            <span>action</span>
          </div>
          {rows.map((item) => (
            <div className="row wide-row" key={item.id}>
              <span>#{item.id}</span>
              <span>{item.problem_summary}</span>
              <span>
                {item.scenario ?? '-'} / {item.level ?? '-'}
              </span>
              <span>{item.recommended ? 'yes' : 'no'}</span>
              <span>{new Date(item.archived_at).toLocaleString()}</span>
              <span>
                <button type="button" onClick={() => void openDetail(item.id)}>
                  detail
                </button>
              </span>
            </div>
          ))}
        </div>
      </article>

      {detailOpen && detail && (
        <div className="modal-backdrop" onClick={() => setDetailOpen(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="panel-headline">
              <h3>Knowledge #{detail.id}</h3>
              <button type="button" onClick={() => setDetailOpen(false)}>
                close
              </button>
            </div>
            <p className="line-metric">
              <span>task ID</span>
              <strong>#{detail.task_id}</strong>
            </p>
            <p className="line-metric">
              <span>scenario/level</span>
              <strong>
                {detail.scenario ?? '-'} / {detail.level ?? '-'}
              </strong>
            </p>
            <article className="modal-section">
              <h4>problem summary</h4>
              <p>{detail.problem_summary}</p>
            </article>
            <article className="modal-section">
              <h4>solution summary</h4>
              <p>{detail.solution_summary}</p>
            </article>
            <article className="modal-section">
              <h4>tags</h4>
              <p>{detail.tags.length > 0 ? detail.tags.join(', ') : '-'}</p>
            </article>
          </div>
        </div>
      )}
    </section>
  )
}
