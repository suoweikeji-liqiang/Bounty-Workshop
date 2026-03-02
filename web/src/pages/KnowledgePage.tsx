import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import { formatScenarioLabel } from '../lib/enumLabels'
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
  if (filters.keyword.trim()) params.set('keyword', filters.keyword.trim())
  if (filters.scenario) params.set('scenario', filters.scenario)
  if (filters.level) params.set('level', filters.level)
  if (filters.recommended !== 'all') params.set('recommended', filters.recommended)
  params.set('offset', String((Math.max(page, 1) - 1) * pageSize))
  params.set('limit', String(pageSize))
  return `?${params.toString()}`
}

function isSameFilters(a: FilterState, b: FilterState): boolean {
  return a.keyword === b.keyword && a.scenario === b.scenario && a.level === b.level && a.recommended === b.recommended
}

export function KnowledgePage({ userId }: Props) {
  const toast = useToast()
  const [filters, setFilters] = useState<FilterState>(defaultFilters)
  const [filtersDraft, setFiltersDraft] = useState<FilterState>(defaultFilters)
  const [rows, setRows] = useState<KnowledgeItem[]>([])
  const [detail, setDetail] = useState<KnowledgeItem | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasNext = useMemo(() => rows.length === pageSize, [rows.length])
  const hasFilterChanges = useMemo(() => !isSameFilters(filters, filtersDraft), [filters, filtersDraft])

  const load = useCallback(
    async (nextFilters: FilterState, nextPage: number) => {
      setLoading(true)
      try {
        setError(null)
        const data = await requestJson<KnowledgeItem[]>(`/knowledge${buildQuery(nextFilters, nextPage)}`, { userId })
        setRows(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载知识条目失败')
      } finally {
        setLoading(false)
      }
    },
    [userId],
  )

  useEffect(() => {
    void load(filters, page)
  }, [filters, page, load])

  useEffect(() => {
    if (!detailOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetailOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [detailOpen])

  useEffect(() => {
    if (!error) return
    toast.error(error)
  }, [error, toast])

  const submitFilters = (event: FormEvent) => {
    event.preventDefault()
    setPage(1)
    setFilters(filtersDraft)
  }

  const resetFilters = () => {
    setFiltersDraft(defaultFilters)
    setFilters(defaultFilters)
    setPage(1)
  }

  const openDetail = async (knowledgeId: number) => {
    try {
      setError(null)
      const payload = await requestJson<KnowledgeItem>(`/knowledge/${knowledgeId}`, { userId })
      setDetail(payload)
      setDetailOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载知识详情失败')
    }
  }

  return (
    <section className="page-wrap">
      <header className="page-head">
        <h2>知识库</h2>
        <p>支持服务端筛选与分页的知识归档中心。</p>
      </header>

      <form className="panel form-grid" onSubmit={submitFilters}>
        <h3>筛选条件</h3>
        <label>
          关键字
          <input
            value={filtersDraft.keyword}
            onChange={(event) => setFiltersDraft((prev) => ({ ...prev, keyword: event.target.value }))}
            placeholder="问题摘要、解决方案或标签"
          />
        </label>
        <label>
          场景
          <select
            value={filtersDraft.scenario}
            onChange={(event) => setFiltersDraft((prev) => ({ ...prev, scenario: event.target.value }))}
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
          等级
          <select
            value={filtersDraft.level}
            onChange={(event) => setFiltersDraft((prev) => ({ ...prev, level: event.target.value }))}
          >
            <option value="">全部</option>
            <option value="S">S</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
        </label>
        <label>
          推荐
          <select
            value={filtersDraft.recommended}
            onChange={(event) =>
              setFiltersDraft((prev) => ({ ...prev, recommended: event.target.value as FilterState['recommended'] }))
            }
          >
            <option value="all">全部</option>
            <option value="true">是</option>
            <option value="false">否</option>
          </select>
        </label>
        <div className="button-row wide">
          <button className="primary-btn" type="submit" disabled={loading || !hasFilterChanges}>
            应用筛选
          </button>
          <button type="button" onClick={resetFilters} disabled={loading}>
            重置
          </button>
          <button type="button" onClick={() => void load(filters, page)} disabled={loading}>
            {loading ? '刷新中...' : '刷新'}
          </button>
        </div>
      </form>

      <article className="panel">
        <div className="panel-headline">
          <h3>知识条目（第 {page} 页）</h3>
          <span className="muted">{rows.length} 条</span>
        </div>
        <div className="button-row">
          <button type="button" onClick={() => setPage((prev) => Math.max(prev - 1, 1))} disabled={page <= 1 || loading}>
            上一页
          </button>
          <button type="button" onClick={() => setPage((prev) => prev + 1)} disabled={!hasNext || loading}>
            下一页
          </button>
        </div>
        <div className="table">
          <div className="row head wide-row">
            <span>ID</span>
            <span>任务</span>
            <span>场景/等级</span>
            <span>是否推荐</span>
            <span>归档时间</span>
            <span>操作</span>
          </div>
          {rows.map((item) => (
            <div className="row wide-row" key={item.id}>
              <span>#{item.id}</span>
              <span>{item.problem_summary}</span>
              <span>
                {formatScenarioLabel(item.scenario)} / {item.level ?? '-'}
              </span>
              <span>{item.recommended ? '是' : '否'}</span>
              <span>{new Date(item.archived_at).toLocaleString()}</span>
              <span>
                <button type="button" onClick={() => void openDetail(item.id)}>
                  详情
                </button>
              </span>
            </div>
          ))}
          {rows.length === 0 && !loading && (
            <div className="row wide-row">
              <span style={{ gridColumn: '1 / -1', textAlign: 'center' }}>暂无数据</span>
            </div>
          )}
        </div>
      </article>

      {detailOpen && detail && (
        <div className="modal-backdrop" onClick={() => setDetailOpen(false)}>
          <div
            className="modal-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="知识详情"
          >
            <div className="panel-headline">
              <h3>知识条目 #{detail.id}</h3>
              <button type="button" onClick={() => setDetailOpen(false)}>
                关闭
              </button>
            </div>
            <p className="line-metric">
              <span>任务 ID</span>
              <strong>#{detail.task_id}</strong>
            </p>
            <p className="line-metric">
              <span>场景/等级</span>
              <strong>
                {formatScenarioLabel(detail.scenario)} / {detail.level ?? '-'}
              </strong>
            </p>
            <article className="modal-section">
              <h4>问题摘要</h4>
              <p>{detail.problem_summary}</p>
            </article>
            <article className="modal-section">
              <h4>方案摘要</h4>
              <p>{detail.solution_summary}</p>
            </article>
            <article className="modal-section">
              <h4>标签</h4>
              <p>{detail.tags.length > 0 ? detail.tags.join(', ') : '-'}</p>
            </article>
          </div>
        </div>
      )}
    </section>
  )
}
