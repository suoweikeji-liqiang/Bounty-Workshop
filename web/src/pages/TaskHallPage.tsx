import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import { requestJson } from '../lib/http'
import type { Task } from '../types'

type Props = {
  userId: number
}

const claimStorageKey = 'bw_claim_records'

function saveClaimRecord(taskId: number, claimId: number) {
  const raw = localStorage.getItem(claimStorageKey)
  const map = raw ? (JSON.parse(raw) as Record<string, number>) : {}
  map[String(taskId)] = claimId
  localStorage.setItem(claimStorageKey, JSON.stringify(map))
}

function getClaimByTask(taskId: number): number | null {
  const raw = localStorage.getItem(claimStorageKey)
  if (!raw) {
    return null
  }
  const map = JSON.parse(raw) as Record<string, number>
  return map[String(taskId)] ?? null
}

export function TaskHallPage({ userId }: Props) {
  const [openTasks, setOpenTasks] = useState<Task[]>([])
  const [inProgressTasks, setInProgressTasks] = useState<Task[]>([])
  const [claimId, setClaimId] = useState('')
  const [summary, setSummary] = useState('')
  const [attachments, setAttachments] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try {
      const [open, progress] = await Promise.all([
        requestJson<Task[]>('/tasks?status=open', { userId }),
        requestJson<Task[]>('/tasks?status=in_progress', { userId }),
      ])
      setOpenTasks(open)
      setInProgressTasks(progress)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    }
  }

  useEffect(() => {
    void load()
  }, [userId])

  const claim = async (taskId: number) => {
    try {
      setError(null)
      const res = await requestJson<{ claim_id: number }>(`/tasks/${taskId}/claims`, {
        method: 'POST',
        userId,
        body: { mode: 'individual' },
      })
      saveClaimRecord(taskId, res.claim_id)
      setMessage(`任务 #${taskId} 揭榜成功，claim_id=${res.claim_id}`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '揭榜失败')
    }
  }

  const submitDeliverable = async (event: FormEvent) => {
    event.preventDefault()
    try {
      setError(null)
      const attachmentIds = attachments
        .split(',')
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isInteger(item) && item > 0)
      await requestJson(`/claims/${claimId}/deliverables`, {
        method: 'POST',
        userId,
        body: {
          summary,
          criteria_results: ['前端提交'],
          evidence_attachment_ids: attachmentIds,
          evidence_urls: [],
        },
      })
      setMessage('成果提交成功')
      setClaimId('')
      setSummary('')
      setAttachments('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '成果提交失败')
    }
  }

  return (
    <section className="page-wrap">
      <header className="page-head">
        <h2>任务大厅</h2>
        <p>公开揭榜与执行反馈。</p>
      </header>
      {message && <p className="ok-text">{message}</p>}
      {error && <p className="error-text">{error}</p>}
      <article className="panel">
        <div className="panel-headline">
          <h3>待揭榜任务</h3>
          <button type="button" onClick={() => void load()}>
            刷新
          </button>
        </div>
        <div className="table">
          <div className="row head">
            <span>ID</span>
            <span>标题</span>
            <span>等级</span>
            <span>激励</span>
            <span>截止</span>
            <span>动作</span>
          </div>
          {openTasks.map((task) => (
            <div className="row" key={task.id}>
              <span>#{task.id}</span>
              <span>{task.title}</span>
              <span>{task.level}</span>
              <span>¥{task.reward_total.toFixed(0)}</span>
              <span>{task.due_date}</span>
              <span>
                <button type="button" onClick={() => void claim(task.id)}>
                  揭榜
                </button>
              </span>
            </div>
          ))}
        </div>
      </article>
      <article className="panel">
        <h3>进行中任务（含本地记录 claim_id）</h3>
        <div className="table">
          <div className="row head">
            <span>ID</span>
            <span>标题</span>
            <span>状态</span>
            <span>claim_id</span>
          </div>
          {inProgressTasks.map((task) => (
            <div className="row" key={task.id}>
              <span>#{task.id}</span>
              <span>{task.title}</span>
              <span>{task.status}</span>
              <span>{getClaimByTask(task.id) ?? '-'}</span>
            </div>
          ))}
        </div>
      </article>
      <form className="panel form-grid" onSubmit={submitDeliverable}>
        <h3>提交成果</h3>
        <label>
          claim_id
          <input value={claimId} onChange={(event) => setClaimId(event.target.value)} required />
        </label>
        <label className="wide">
          成果说明
          <textarea value={summary} onChange={(event) => setSummary(event.target.value)} required />
        </label>
        <label className="wide">
          证据附件 ID（逗号分隔）
          <input
            value={attachments}
            onChange={(event) => setAttachments(event.target.value)}
            placeholder="例如: 8,9"
          />
        </label>
        <button className="primary-btn" type="submit">
          提交成果
        </button>
      </form>
    </section>
  )
}
