import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import type { AIModel } from '../types'

type Props = {
  userId: number
}

export function AIModelConfigPage({ userId }: Props) {
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const [models, setModels] = useState<AIModel[]>([])
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [testing, setTesting] = useState<number | null>(null)
  const [loadingApiKeyId, setLoadingApiKeyId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [revealedApiKeys, setRevealedApiKeys] = useState<Record<number, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedModel = useMemo(() => models.find((item) => item.id === selectedModelId) ?? null, [models, selectedModelId])
  const encodedBack = encodeURIComponent(`${location.pathname}${location.search}`)

  const loadModels = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await requestJson<AIModel[]>('/ai/models', { userId })
      setModels(rows)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void loadModels()
  }, [loadModels])

  const handleDelete = async (id: number) => {
    try {
      setDeletingId(id)
      await requestJson(`/ai/models/${id}`, { method: 'DELETE', userId })
      setMessage('模型已删除')
      if (selectedModelId === id) {
        setSelectedModelId(null)
      }
      await loadModels()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setDeletingId(null)
    }
  }

  const handleRevealApiKey = async (id: number) => {
    try {
      setLoadingApiKeyId(id)
      setError(null)
      const payload = await requestJson<{ api_key: string }>(`/ai/models/${id}/api-key`, { userId })
      setRevealedApiKeys((prev) => ({ ...prev, [id]: payload.api_key }))
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取 API Key 失败')
    } finally {
      setLoadingApiKeyId(null)
    }
  }

  const handleTestSaved = async (id: number) => {
    setTesting(id)
    try {
      const res = await requestJson<{ ok: boolean; latency_ms: number; error: string | null }>(
        `/ai/models/${id}/test`,
        { method: 'POST', userId },
      )
      if (res.ok) {
        toast.success(`连接成功 (${res.latency_ms}ms)`)
      } else {
        toast.error(`连接失败: ${res.error}`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '测试失败')
    } finally {
      setTesting(null)
    }
  }

  useEffect(() => {
    if (message) toast.success(message)
  }, [message, toast])

  useEffect(() => {
    if (error) toast.error(error)
  }, [error, toast])

  return (
    <section className="page-wrap">
      <header className="page-head">
        <h2>AI 模型配置</h2>
        <p>管理 ProdMind 论证服务使用的 AI 模型配置。</p>
      </header>

      <article className="panel">
        <div className="panel-headline">
          <h3>已配置模型（{models.length}）</h3>
          <div className="button-row">
            <button type="button" onClick={() => navigate(`/ai-models/new?back=${encodedBack}`)}>
              新增模型
            </button>
            <button type="button" onClick={() => void loadModels()} disabled={loading}>
              刷新
            </button>
          </div>
        </div>
        <div className="table">
          <div className="row head ai-model-row">
            <span>ID</span>
            <span>名称</span>
            <span>供应商</span>
            <span>模型</span>
            <span>默认</span>
            <span>状态</span>
            <span>操作</span>
          </div>
          {models.map((item) => (
            <div className="row ai-model-row" key={item.id}>
              <span>#{item.id}</span>
              <span title={item.name}>{item.name}</span>
              <span>{item.provider}</span>
              <span title={item.model}>{item.model}</span>
              <span>{item.is_default ? '是' : '-'}</span>
              <span>{item.enabled ? '启用' : '禁用'}</span>
              <span className="actions">
                <button type="button" onClick={() => setSelectedModelId(item.id)}>
                  详情
                </button>
                <button type="button" onClick={() => navigate(`/ai-models/${item.id}/edit?back=${encodedBack}`)}>
                  编辑
                </button>
              </span>
            </div>
          ))}
          {models.length === 0 && !loading && (
            <div className="row ai-model-row">
              <span style={{ textAlign: 'center', color: '#888', gridColumn: '1 / -1' }}>暂无配置，请先添加模型</span>
            </div>
          )}
        </div>
      </article>

      {selectedModel && (
        <div className="modal-backdrop" onClick={() => setSelectedModelId(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="ai-model-manage-title">
            <div className="panel-headline">
              <h3 id="ai-model-manage-title">模型详情 #{selectedModel.id}</h3>
              <button type="button" onClick={() => setSelectedModelId(null)}>
                关闭
              </button>
            </div>
            <p className="line-metric">
              <span>名称 / 供应商</span>
              <strong>
                {selectedModel.name} / {selectedModel.provider}
              </strong>
            </p>
            <p className="line-metric">
              <span>模型</span>
              <strong>{selectedModel.model}</strong>
            </p>
            <p className="line-metric">
              <span>API 地址</span>
              <strong>{selectedModel.api_base_url}</strong>
            </p>
            <p className="line-metric">
              <span>默认 / 启用</span>
              <strong>
                {selectedModel.is_default ? '默认' : '非默认'} / {selectedModel.enabled ? '启用' : '禁用'}
              </strong>
            </p>
            <p className="line-metric">
              <span>参数</span>
              <strong>
                max_tokens={selectedModel.max_tokens}, temp={selectedModel.temperature}, timeout={selectedModel.timeout}
              </strong>
            </p>
            {revealedApiKeys[selectedModel.id] && (
              <article className="modal-section">
                <h4>API Key（明文）</h4>
                <code style={{ display: 'block', overflowX: 'auto', whiteSpace: 'nowrap' }}>{revealedApiKeys[selectedModel.id]}</code>
              </article>
            )}
            <div className="button-row">
              <button type="button" onClick={() => void handleTestSaved(selectedModel.id)} disabled={testing === selectedModel.id}>
                {testing === selectedModel.id ? '测试中...' : '测试连接'}
              </button>
              <button
                type="button"
                onClick={() => void handleRevealApiKey(selectedModel.id)}
                disabled={loadingApiKeyId === selectedModel.id}
              >
                {loadingApiKeyId === selectedModel.id ? '读取中...' : '查看 API Key'}
              </button>
              <button
                type="button"
                onClick={() => {
                  navigate(`/ai-models/${selectedModel.id}/edit?back=${encodedBack}`)
                  setSelectedModelId(null)
                }}
              >
                编辑
              </button>
              <button type="button" onClick={() => void handleDelete(selectedModel.id)} disabled={deletingId === selectedModel.id}>
                {deletingId === selectedModel.id ? '删除中...' : '删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
