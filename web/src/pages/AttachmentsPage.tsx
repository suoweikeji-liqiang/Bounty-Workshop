import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { useToast } from '../components/ToastProvider'
import { downloadFile, requestJson } from '../lib/http'
import { formatProblemStatusLabel } from '../lib/enumLabels'
import type { Attachment, ClaimExecution, Problem, UserProfile } from '../types'

type Props = {
  userId: number
}

type DeliverableOption = {
  deliverableId: number
  taskTitle: string
}

type AttachmentsView = 'entity' | 'attachment'

export function AttachmentsPage({ userId }: Props) {
  const toast = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [problems, setProblems] = useState<Problem[]>([])
  const [claims, setClaims] = useState<ClaimExecution[]>([])
  const [users, setUsers] = useState<UserProfile[]>([])
  const [myAttachments, setMyAttachments] = useState<Attachment[]>([])
  const [view, setView] = useState<AttachmentsView>('entity')
  const [entityType, setEntityType] = useState<'problem' | 'deliverable'>('problem')
  const [selectedProblemId, setSelectedProblemId] = useState('')
  const [selectedDeliverableId, setSelectedDeliverableId] = useState('')
  const [lookupAttachmentId, setLookupAttachmentId] = useState('')
  const [lookupSearch, setLookupSearch] = useState('')
  const [attachment, setAttachment] = useState<Attachment | null>(null)
  const [entityAttachments, setEntityAttachments] = useState<Attachment[]>([])
  const [loadingRefs, setLoadingRefs] = useState(false)
  const [loadingEntity, setLoadingEntity] = useState(false)
  const [uploading, setUploading] = useState(false)
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
          taskTitle: item.task_title,
        })
      }
    }
    return Array.from(map.values()).sort((a, b) => b.deliverableId - a.deliverableId)
  }, [claims])

  const selectedEntityId = entityType === 'problem' ? selectedProblemId : selectedDeliverableId
  const userNameMap = useMemo(
    () => new Map<number, string>(users.map((item) => [item.id, item.name])),
    [users],
  )
  const filteredAttachmentOptions = useMemo(() => {
    const keyword = lookupSearch.trim().toLowerCase()
    if (!keyword) {
      return myAttachments
    }
    return myAttachments.filter((item) => {
      const value = `${item.filename} ${item.content_type} ${item.id}`.toLowerCase()
      return value.includes(keyword)
    })
  }, [lookupSearch, myAttachments])
  const problemTitleMap = useMemo(
    () => new Map<number, string>(problems.map((item) => [item.id, item.title])),
    [problems],
  )
  const deliverableTitleMap = useMemo(
    () => new Map<number, string>(deliverableOptions.map((item) => [item.deliverableId, item.taskTitle])),
    [deliverableOptions],
  )

  const formatEntityReference = (entry: Attachment) => {
    if (!entry.entity_type || entry.entity_id == null) {
      return '-'
    }
    if (entry.entity_type === 'problem') {
      return problemTitleMap.get(entry.entity_id) ?? `问题${entry.entity_id}`
    }
    if (entry.entity_type === 'deliverable') {
      return deliverableTitleMap.get(entry.entity_id) ?? `成果${entry.entity_id}`
    }
    return `${entry.entity_type} / ${entry.entity_id}`
  }

  const loadReferenceData = useCallback(async () => {
    try {
      setLoadingRefs(true)
      setError(null)
      const [problemRows, claimRows, userRows, attachmentRows] = await Promise.all([
        requestJson<Problem[]>('/problems?limit=200', { userId }),
        requestJson<ClaimExecution[]>('/claims/mine', { userId }),
        requestJson<UserProfile[]>('/users/active', { userId }),
        requestJson<Attachment[]>('/attachments/mine/list?limit=200', { userId }),
      ])
      setProblems(problemRows)
      setClaims(claimRows)
      setUsers(userRows)
      setMyAttachments(attachmentRows)

      setSelectedProblemId((prev) => {
        if (prev && problemRows.some((item) => String(item.id) === prev)) {
          return prev
        }
        return problemRows.length > 0 ? String(problemRows[0].id) : ''
      })

      const nextDeliverableIds = Array.from(
        claimRows.reduce((set, item) => {
          if (item.deliverable_id) {
            set.add(String(item.deliverable_id))
          }
          return set
        }, new Set<string>()),
      )
      setSelectedDeliverableId((prev) => {
        if (prev && nextDeliverableIds.includes(prev)) {
          return prev
        }
        return nextDeliverableIds.length > 0 ? nextDeliverableIds[0] : ''
      })
      setLookupAttachmentId((prev) => {
        if (prev && attachmentRows.some((item) => String(item.id) === prev)) {
          return prev
        }
        return attachmentRows.length > 0 ? String(attachmentRows[0].id) : ''
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载问题与成果引用失败')
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
      setUploading(true)
      setError(null)
      const data = new FormData()
      data.append('file', file)
      const res = await requestJson<Attachment>('/attachments/upload', {
        method: 'POST',
        userId,
        formData: data,
      })
      setAttachment(res)
      setLookupAttachmentId(String(res.id))
      setMyAttachments((prev) => [res, ...prev.filter((item) => item.id !== res.id)])
      setMessage(`上传成功：${res.filename}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }

  const lookupAttachment = async () => {
    const id = Number(lookupAttachmentId)
    if (!Number.isInteger(id) || id <= 0) {
      setError('请先选择附件')
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
      setError(entityType === 'problem' ? '请先选择问题' : '请先选择成果')
      return
    }

    try {
      setLoadingEntity(true)
      setError(null)
      const res = await requestJson<Attachment[]>(`/entities/${entityType}/${id}/attachments`, { userId })
      setEntityAttachments(res)
      if (res.length > 0) {
        setAttachment(res[0])
        setLookupAttachmentId(String(res[0].id))
      } else {
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
        <p>上传证据、按实体查询、查看详情并下载。</p>
      </header>

      <form className="panel form-grid" onSubmit={upload}>
        <h3>上传附件</h3>
        <label className="wide">
          选择文件
          <input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        <div className="button-row wide">
          <button className="primary-btn" type="submit" disabled={uploading}>
            {uploading ? '上传中...' : '上传'}
          </button>
          <button type="button" onClick={() => void loadReferenceData()} disabled={loadingRefs}>
            {loadingRefs ? '刷新中...' : '刷新问题/成果列表'}
          </button>
        </div>
      </form>

      <article className="panel">
        <div className="button-row">
          <button
            type="button"
            className={view === 'entity' ? 'primary-btn' : ''}
            onClick={() => setView('entity')}
          >
            按实体查询
          </button>
          <button
            type="button"
            className={view === 'attachment' ? 'primary-btn' : ''}
            onClick={() => setView('attachment')}
          >
            按附件搜索
          </button>
        </div>
      </article>

      {view === 'entity' && (
        <article className="panel form-grid">
          <h3 className="wide">按实体查附件</h3>
          <label>
            实体类型
            <select value={entityType} onChange={(event) => setEntityType(event.target.value as 'problem' | 'deliverable')}>
              <option value="problem">问题</option>
              <option value="deliverable">成果</option>
            </select>
          </label>

          {entityType === 'problem' ? (
            <label className="wide">
              选择问题
              <select value={selectedProblemId} onChange={(event) => setSelectedProblemId(event.target.value)}>
                {problems.length === 0 && <option value="">暂无问题</option>}
                {problems.map((item) => (
                  <option key={`problem-${item.id}`} value={item.id}>
                    [{formatProblemStatusLabel(item.status)}] {item.title}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="wide">
              选择成果
              <select value={selectedDeliverableId} onChange={(event) => setSelectedDeliverableId(event.target.value)}>
                {deliverableOptions.length === 0 && <option value="">暂无成果</option>}
                {deliverableOptions.map((item) => (
                  <option key={`deliverable-${item.deliverableId}`} value={item.deliverableId}>
                    {item.taskTitle}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="button-row wide">
            <button type="button" onClick={() => void loadEntityAttachments()} disabled={loadingEntity}>
              {loadingEntity ? '查询中...' : '查询附件列表'}
            </button>
          </div>

          <div className="wide table">
            <div className="row head">
              <span>文件名</span>
              <span>上传时间</span>
              <span>存储</span>
              <span>操作</span>
            </div>
            {entityAttachments.map((item) => (
              <div className="row" key={item.id}>
                <span title={item.filename}>{item.filename}</span>
                <span>{new Date(item.created_at).toLocaleString()}</span>
                <span>{item.storage_backend}</span>
                <span className="actions">
                  <button
                    type="button"
                    onClick={() => {
                      setAttachment(item)
                      setLookupAttachmentId(String(item.id))
                    }}
                  >
                    查看详情
                  </button>
                  <button type="button" onClick={() => void downloadFile(item.download_url, item.filename, { userId })}>
                    下载
                  </button>
                </span>
              </div>
            ))}
            {entityAttachments.length === 0 && (
              <div className="row">
                <span style={{ gridColumn: '1 / -1', textAlign: 'center' }}>当前实体暂无附件</span>
              </div>
            )}
          </div>
        </article>
      )}

      {view === 'attachment' && (
        <article className="panel form-grid">
          <h3 className="wide">按附件搜索</h3>
          <label>
            搜索关键词
            <input
              type="search"
              value={lookupSearch}
              onChange={(event) => setLookupSearch(event.target.value)}
              placeholder="按文件名或类型筛选"
              disabled={myAttachments.length === 0}
            />
          </label>
          <label>
            选择附件
            <select
              value={lookupAttachmentId}
              onChange={(event) => setLookupAttachmentId(event.target.value)}
              disabled={myAttachments.length === 0}
            >
              {myAttachments.length === 0 && <option value="">暂无可选附件</option>}
              {filteredAttachmentOptions.map((item) => (
                <option key={`my-attachment-${item.id}`} value={item.id}>
                  {item.filename}
                </option>
              ))}
            </select>
          </label>
          <div className="button-row" style={{ alignItems: 'end' }}>
            <button type="button" onClick={() => void lookupAttachment()}>
              查看附件详情
            </button>
          </div>
        </article>
      )}

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
            <span>类型 / 大小</span>
            <strong>
              {attachment.content_type} / {attachment.size_bytes} 字节
            </strong>
          </p>
          <p className="line-metric">
            <span>存储后端</span>
            <strong>{attachment.storage_backend}</strong>
          </p>
          <p className="line-metric">
            <span>关联实体</span>
            <strong>{formatEntityReference(attachment)}</strong>
          </p>
          <p className="line-metric">
            <span>上传人 / 时间</span>
            <strong>
              {userNameMap.get(attachment.uploader_user_id) ?? `用户${attachment.uploader_user_id}`} / {new Date(attachment.created_at).toLocaleString()}
            </strong>
          </p>
          <div className="button-row">
            <button
              className="primary-btn"
              type="button"
              onClick={() => void downloadFile(attachment.download_url, attachment.filename, { userId })}
            >
              下载附件
            </button>
          </div>
        </article>
      )}
    </section>
  )
}
