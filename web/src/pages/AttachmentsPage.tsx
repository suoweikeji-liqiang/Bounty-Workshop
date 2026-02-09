import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import { useToast } from '../components/ToastProvider'
import { apiBaseUrl, requestJson } from '../lib/http'
import type { Attachment } from '../types'

type Props = {
  userId: number
}

export function AttachmentsPage({ userId }: Props) {
  const toast = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [lookupId, setLookupId] = useState('')
  const [entityType, setEntityType] = useState<'problem' | 'deliverable'>('problem')
  const [entityId, setEntityId] = useState('')
  const [attachment, setAttachment] = useState<Attachment | null>(null)
  const [entityAttachments, setEntityAttachments] = useState<Attachment[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
      setMessage(`上传成功，附件 ID=${res.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败')
    }
  }

  const lookup = async () => {
    try {
      setError(null)
      const res = await requestJson<Attachment>(`/attachments/${lookupId}`, { userId })
      setAttachment(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : '查询失败')
    }
  }

  const loadEntityAttachments = async () => {
    try {
      setError(null)
      const res = await requestJson<Attachment[]>(`/entities/${entityType}/${entityId}/attachments`, { userId })
      setEntityAttachments(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : '查询失败')
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
        <h2>附件中心</h2>
        <p>上传证据、绑定实体、追踪下载。</p>
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
        <h3>查询附件</h3>
        <label>
          附件 ID
          <input value={lookupId} onChange={(event) => setLookupId(event.target.value)} />
        </label>
        <button type="button" onClick={() => void lookup()}>
          查询元数据
        </button>
      </article>
      <article className="panel form-grid">
        <h3>按实体查附件</h3>
        <label>
          实体类型
          <select value={entityType} onChange={(event) => setEntityType(event.target.value as 'problem' | 'deliverable')}>
            <option value="problem">问题</option>
            <option value="deliverable">成果</option>
          </select>
        </label>
        <label>
          实体 ID
          <input value={entityId} onChange={(event) => setEntityId(event.target.value)} />
        </label>
        <button type="button" onClick={() => void loadEntityAttachments()}>
          查询列表
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
          <a
            className="ghost-btn"
            href={`${apiBaseUrl}${attachment.download_url}`}
            target="_blank"
            rel="noreferrer"
          >
            下载附件
          </a>
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
                <a href={`${apiBaseUrl}${item.download_url}`} target="_blank" rel="noreferrer">
                  打开
                </a>
              </span>
            </div>
          ))}
        </div>
      </article>
    </section>
  )
}
