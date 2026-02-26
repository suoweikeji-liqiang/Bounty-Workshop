import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { useToast } from '../components/ToastProvider'
import { downloadFile, requestJson } from '../lib/http'
import type { Attachment, ClaimExecution, Problem } from '../types'

type Props = {
  userId: number
}

type DeliverableOption = {
  deliverableId: number
  claimId: number
  taskTitle: string
}

export function AttachmentsPage({ userId }: Props) {
  const toast = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [problems, setProblems] = useState<Problem[]>([])
  const [claims, setClaims] = useState<ClaimExecution[]>([])
  const [entityType, setEntityType] = useState<'problem' | 'deliverable'>('problem')
  const [selectedProblemId, setSelectedProblemId] = useState('')
  const [selectedDeliverableId, setSelectedDeliverableId] = useState('')
  const [selectedAttachmentId, setSelectedAttachmentId] = useState('')
  const [attachment, setAttachment] = useState<Attachment | null>(null)
  const [entityAttachments, setEntityAttachments] = useState<Attachment[]>([])
  const [loadingRefs, setLoadingRefs] = useState(false)
  const [loadingEntity, setLoadingEntity] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const deliverableOptions = useMemo<DeliverableOption[]>(() => {
    const map = new Map<number, DeliverableOption>()
    for (const item of claims) {
      if (!item.deliverable_id) {
        continue
      }
      if (!map.has(item.deliverable_id)) {
        map.set(item.deliverable_id, {
          deliverableId: item.deliverable_id,
          claimId: item.claim_id,
          taskTitle: item.task_title,
        })
      }
    }
    return Array.from(map.values()).sort((a, b) => b.deliverableId - a.deliverableId)
  }, [claims])

  const selectedEntityId = entityType === 'problem' ? selectedProblemId : selectedDeliverableId

  const attachmentOptions = useMemo(() => {
    const map = new Map<number, Attachment>()
    for (const item of entityAttachments) {
      map.set(item.id, item)
    }
    if (attachment) {
      map.set(attachment.id, attachment)
    }
    return Array.from(map.values()).sort((a, b) => b.id - a.id)
  }, [attachment, entityAttachments])

  const loadReferenceData = useCallback(async () => {
    try {
      setLoadingRefs(true)
      setError(null)
      const [problemRows, claimRows] = await Promise.all([
        requestJson<Problem[]>('/problems?mine_only=true&limit=200', { userId }),
        requestJson<ClaimExecution[]>('/claims/mine', { userId }),
      ])
      setProblems(problemRows)
      setClaims(claimRows)

      setSelectedProblemId((prev) => {
        if (prev && problemRows.some((item) => String(item.id) === prev)) {
          return prev
        }
        return problemRows.length > 0 ? String(problemRows[0].id) : ''
      })

      setSelectedDeliverableId((prev) => {
        const nextOptions = (() => {
          const map = new Map<number, boolean>()
          for (const item of claimRows) {
            if (item.deliverable_id) {
              map.set(item.deliverable_id, true)
            }
          }
          return Array.from(map.keys()).sort((a, b) => b - a)
        })()

        if (prev && nextOptions.some((id) => String(id) === prev)) {
          return prev
        }
        return nextOptions.length > 0 ? String(nextOptions[0]) : ''
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载引用数据失败')
    } finally {
      setLoadingRefs(false)
    }
  }, [userId])

  const upload = async (event: FormEvent) => {
    event.preventDefault()
    if (!file) {
      setError('请先选择文件')
      return
    }
    try {
      setError(null)
      const data = new FormData()
      data.append('file', file)
      const res = await requestJson<Attachment>('/attachments/upload', {
        method: 'POST',
        userId,
        formData: data,
      })
      setAttachment(res)
      setSelectedAttachmentId(String(res.id))
      setMessage(`上传成功，附件 ID=${res.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败')
    }
  }

  const lookupAttachment = async () => {
    const id = Number(selectedAttachmentId)
    if (!Number.isInteger(id) || id <= 0) {
      setError('请选择有效附件')
      return
    }

    try {
      setError(null)
      const res = await requestJson<Attachment>(`/attachments/${id}`, { userId })
      setAttachment(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : '查询失败')
    }
  }

  const loadEntityAttachments = async () => {
    const id = Number(selectedEntityId)
    if (!Number.isInteger(id) || id <= 0) {
      setError(entityType === 'problem' ? '请选择问题' : '请选择交付成果')
      return
    }

    try {
      setLoadingEntity(true)
      setError(null)
      const res = await requestJson<Attachment[]>(`/entities/${entityType}/${id}/attachments`, { userId })
      setEntityAttachments(res)
      setSelectedAttachmentId(res.length > 0 ? String(res[0].id) : '')
      if (res.length === 0) {
        setAttachment(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '查询失败')
    } finally {
      setLoadingEntity(false)
    }
  }

  useEffect(() => {
    void loadReferenceData()
  }, [loadReferenceData])

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
        <h2>附件中心</h2>
        <p>上传证据、按实体查看附件、查看附件详情与下载。</p>
      </header>

      <form className="panel form-grid" onSubmit={upload}>
        <h3>上传附件</h3>
        <label className="wide">
          选择文件
          <input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        <button className="primary-btn" type="submit">
          上传
        </button>
      </form>

      <article className="panel form-grid">
        <h3>按实体查附件</h3>
        <label>
          实体类型
          <select value={entityType} onChange={(event) => setEntityType(event.target.value as 'problem' | 'deliverable')}>
            <option value="problem">问题</option>
            <option value="deliverable">成果</option>
          </select>
        </label>

        {entityType === 'problem' ? (
          <label>
            选择问题
            <select value={selectedProblemId} onChange={(event) => setSelectedProblemId(event.target.value)}>
              {problems.length === 0 && <option value="">暂无问题</option>}
              {problems.map((item) => (
                <option key={`problem-${item.id}`} value={item.id}>
                  #{item.id} [{item.status}] {item.title}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            选择成果
            <select value={selectedDeliverableId} onChange={(event) => setSelectedDeliverableId(event.target.value)}>
              {deliverableOptions.length === 0 && <option value="">暂无成果</option>}
              {deliverableOptions.map((item) => (
                <option key={`deliverable-${item.deliverableId}`} value={item.deliverableId}>
                  #{item.deliverableId} (claim #{item.claimId}) {item.taskTitle}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="button-row wide">
          <button type="button" onClick={() => void loadReferenceData()} disabled={loadingRefs}>
            {loadingRefs ? '刷新中...' : '刷新列表'}
          </button>
          <button type="button" onClick={() => void loadEntityAttachments()} disabled={loadingEntity}>
            {loadingEntity ? '查询中...' : '查询附件列表'}
          </button>
        </div>
      </article>

      <article className="panel form-grid">
        <h3>查看附件详情</h3>
        <label>
          选择附件
          <select value={selectedAttachmentId} onChange={(event) => setSelectedAttachmentId(event.target.value)}>
            {attachmentOptions.length === 0 && <option value="">暂无附件</option>}
            {attachmentOptions.map((item) => (
              <option key={`attachment-${item.id}`} value={item.id}>
                #{item.id} {item.filename}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => void lookupAttachment()}>
          查询元数据
        </button>
      </article>

      {attachment && (
        <article className="panel">
          <h3>附件详情</h3>
          <p className="line-metric">
            <span>ID</span>
            <strong>{attachment.id}</strong>
          </p>
          <p className="line-metric">
            <span>文件名</span>
            <strong>{attachment.filename}</strong>
          </p>
          <p className="line-metric">
            <span>大小</span>
            <strong>{attachment.size_bytes} 字节</strong>
          </p>
          <p className="line-metric">
            <span>后端</span>
            <strong>{attachment.storage_backend}</strong>
          </p>
          <button
            className="ghost-btn"
            type="button"
            onClick={() => void downloadFile(attachment.download_url, attachment.filename, { userId })}
          >
            下载附件
          </button>
        </article>
      )}

      <article className="panel">
        <h3>实体附件列表</h3>
        <div className="table">
          <div className="row head">
            <span>ID</span>
            <span>文件名</span>
            <span>后端</span>
            <span>下载</span>
          </div>
          {entityAttachments.map((item) => (
            <div className="row" key={item.id}>
              <span>{item.id}</span>
              <span>{item.filename}</span>
              <span>{item.storage_backend}</span>
              <span>
                <button type="button" onClick={() => void downloadFile(item.download_url, item.filename, { userId })}>
                  打开
                </button>
              </span>
            </div>
          ))}
        </div>
      </article>
    </section>
  )
}
