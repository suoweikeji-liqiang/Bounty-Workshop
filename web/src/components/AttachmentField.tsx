import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'

import { apiBaseUrl, requestJson } from '../lib/http'
import type { Attachment } from '../types'
import { useToast } from './ToastProvider'

type Props = {
  userId: number
  value: Attachment[]
  onChange: (next: Attachment[]) => void
  label?: string
}

function dedupeById(items: Attachment[]): Attachment[] {
  const map = new Map<number, Attachment>()
  for (const item of items) {
    map.set(item.id, item)
  }
  return Array.from(map.values())
}

export function AttachmentField({ userId, value, onChange, label = 'Attachments' }: Props) {
  const toast = useToast()
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const uploadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files
    if (!fileList || fileList.length === 0) {
      return
    }

    setUploading(true)
    const uploaded: Attachment[] = []
    try {
      for (const file of Array.from(fileList)) {
        const data = new FormData()
        data.append('file', file)
        const res = await requestJson<Attachment>('/attachments/upload', {
          method: 'POST',
          userId,
          formData: data,
        })
        uploaded.push(res)
      }
      onChange(dedupeById([...value, ...uploaded]))
      toast.success(`Uploaded ${uploaded.length} attachment(s)`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Attachment upload failed')
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      setUploading(false)
    }
  }

  return (
    <div className="attachment-field wide">
      <div className="panel-headline">
        <h3>{label}</h3>
      </div>
      <label>
        Select files (multiple)
        <input ref={fileInputRef} type="file" multiple onChange={(event) => void uploadFiles(event)} />
      </label>
      {uploading && <p className="muted">Uploading attachments...</p>}
      {value.length > 0 && (
        <div className="attachment-list">
          {value.map((item) => (
            <div className="attachment-item" key={item.id}>
              <span>#{item.id}</span>
              <span>{item.filename}</span>
              <span>{item.size_bytes} B</span>
              <a href={`${apiBaseUrl}${item.download_url}`} target="_blank" rel="noreferrer">
                Open
              </a>
              <button type="button" onClick={() => onChange(value.filter((row) => row.id !== item.id))}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

