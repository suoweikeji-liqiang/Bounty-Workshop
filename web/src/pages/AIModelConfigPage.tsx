import { useCallback, useEffect, useState } from 'react'

import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import type { AIModel, AIProvider } from '../types'

type Props = {
  userId: number
}

type ModelForm = {
  name: string
  provider: AIProvider
  api_base_url: string
  api_key: string
  model: string
  is_default: boolean
  enabled: boolean
  max_tokens: number
  temperature: number
  timeout: number
}

const defaultForm: ModelForm = {
  name: '',
  provider: 'openai',
  api_base_url: 'https://api.openai.com/v1',
  api_key: '',
  model: 'gpt-4o',
  is_default: false,
  enabled: true,
  max_tokens: 4096,
  temperature: 0.7,
  timeout: 60,
}

const providerOptions: { value: AIProvider; label: string; defaultUrl: string; defaultModel: string }[] = [
  { value: 'openai', label: 'OpenAI', defaultUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o' },
  {
    value: 'anthropic',
    label: 'Anthropic (Claude)',
    defaultUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-sonnet-20240229',
  },
  { value: 'deepseek', label: 'DeepSeek', defaultUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' },
  {
    value: 'siliconflow',
    label: '硅基流动',
    defaultUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
  },
  { value: 'ollama', label: 'Ollama (本地)', defaultUrl: 'http://localhost:11434', defaultModel: 'llama3' },
  { value: 'custom', label: '自定义 (OpenAI 兼容)', defaultUrl: '', defaultModel: '' },
]

export function AIModelConfigPage({ userId }: Props) {
  const toast = useToast()
  const [models, setModels] = useState<AIModel[]>([])
  const [form, setForm] = useState<ModelForm>(defaultForm)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<number | 'form' | null>(null)
  const [loadingApiKeyId, setLoadingApiKeyId] = useState<number | null>(null)
  const [revealedApiKeys, setRevealedApiKeys] = useState<Record<number, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  const resetForm = () => {
    setForm(defaultForm)
    setEditingId(null)
  }

  const handleProviderChange = (provider: AIProvider) => {
    const opt = providerOptions.find((o) => o.value === provider)
    setForm((prev) => ({
      ...prev,
      provider,
      api_base_url: opt?.defaultUrl || '',
      model: opt?.defaultModel || '',
    }))
  }

  const handleEdit = (model: AIModel) => {
    setEditingId(model.id)
    setForm({
      name: model.name,
      provider: model.provider,
      api_base_url: model.api_base_url,
      api_key: '',
      model: model.model,
      is_default: model.is_default,
      enabled: model.enabled,
      max_tokens: model.max_tokens,
      temperature: model.temperature,
      timeout: model.timeout,
    })
  }

  const handleDelete = async (id: number) => {
    if (!window.confirm('确定要删除这个模型配置吗？')) return
    try {
      await requestJson(`/ai/models/${id}`, { method: 'DELETE', userId })
      setMessage('模型已删除')
      await loadModels()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
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

  const handleTestForm = async () => {
    if (!form.api_base_url.trim() || !form.api_key.trim() || !form.model.trim()) {
      toast.error('请先填写 API 地址、API Key 和模型名称')
      return
    }
    setTesting('form')
    try {
      const res = await requestJson<{ ok: boolean; latency_ms: number; error: string | null }>('/ai/models/test', {
        method: 'POST',
        userId,
        body: {
          api_base_url: form.api_base_url,
          api_key: form.api_key,
          model: form.model,
          provider: form.provider,
          timeout: form.timeout,
        },
      })
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) {
      setError('请输入模型名称')
      return
    }
    if (!form.api_base_url.trim()) {
      setError('请输入 API 地址')
      return
    }
    if (!form.model.trim()) {
      setError('请输入模型名称')
      return
    }

    try {
      setSaving(true)
      setError(null)
      const body: Record<string, unknown> = { ...form }
      if (!body.api_key) {
        delete (body as Record<string, unknown>)['api_key']
      }

      if (editingId) {
        await requestJson(`/ai/models/${editingId}`, { method: 'PUT', userId, body })
        setMessage('模型已更新')
      } else {
        await requestJson('/ai/models', { method: 'POST', userId, body })
        setMessage('模型已创建')
      }
      resetForm()
      await loadModels()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
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

      <form className="panel form-grid" onSubmit={handleSubmit}>
        <h3>{editingId ? `编辑模型 #${editingId}` : '新增模型'}</h3>
        <label>
          显示名称
          <input
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            placeholder="例如：GPT-4o"
            required
          />
        </label>
        <label>
          供应商
          <select value={form.provider} onChange={(e) => handleProviderChange(e.target.value as AIProvider)}>
            {providerOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          API 地址
          <input
            value={form.api_base_url}
            onChange={(e) => setForm((p) => ({ ...p, api_base_url: e.target.value }))}
            placeholder="https://api.example.com/v1"
            required
          />
        </label>
        <label>
          API Key
          <input
            type="password"
            value={form.api_key}
            onChange={(e) => setForm((p) => ({ ...p, api_key: e.target.value }))}
            placeholder={editingId ? '(留空表示不修改)' : '请输入 API Key'}
          />
        </label>
        <label>
          模型名称
          <input
            value={form.model}
            onChange={(e) => setForm((p) => ({ ...p, model: e.target.value }))}
            placeholder="例如：gpt-4o"
            required
          />
        </label>
        <label>
          最大 Tokens
          <input
            type="number"
            value={form.max_tokens}
            onChange={(e) => setForm((p) => ({ ...p, max_tokens: Number(e.target.value) }))}
            min={1}
            max={128000}
          />
        </label>
        <label>
          Temperature
          <input
            type="number"
            step="0.1"
            min={0}
            max={2}
            value={form.temperature}
            onChange={(e) => setForm((p) => ({ ...p, temperature: Number(e.target.value) }))}
          />
        </label>
        <label>
          超时（秒）
          <input
            type="number"
            min={10}
            max={300}
            value={form.timeout}
            onChange={(e) => setForm((p) => ({ ...p, timeout: Number(e.target.value) }))}
          />
        </label>
        <div className="checks">
          <label>
            <input
              type="checkbox"
              checked={form.is_default}
              onChange={(e) => setForm((p) => ({ ...p, is_default: e.target.checked }))}
            />
            默认模型
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))}
            />
            启用
          </label>
        </div>
        <div className="button-row wide">
          {editingId && (
            <button type="button" onClick={resetForm}>
              取消编辑
            </button>
          )}
          <button type="button" onClick={() => void handleTestForm()} disabled={testing === 'form'}>
            {testing === 'form' ? '测试中...' : '测试连接'}
          </button>
          <button className="primary-btn" type="submit" disabled={saving}>
            {saving ? '保存中...' : editingId ? '更新模型' : '创建模型'}
          </button>
        </div>
      </form>

      <article className="panel">
        <div className="panel-headline">
          <h3>已配置模型（{models.length}）</h3>
          <button type="button" onClick={() => void loadModels()} disabled={loading}>
            刷新
          </button>
        </div>
        <div className="table">
          <div className="row head wide-row">
            <span>ID</span>
            <span>名称</span>
            <span>供应商</span>
            <span>模型</span>
            <span>默认</span>
            <span>状态</span>
            <span>操作</span>
          </div>
          {models.map((item) => (
            <div className="row wide-row" key={item.id}>
              <span>#{item.id}</span>
              <span>{item.name}</span>
              <span>{item.provider}</span>
              <span>{item.model}</span>
              <span>{item.is_default ? '是' : '-'}</span>
              <span>{item.enabled ? '启用' : '禁用'}</span>
              <span className="actions">
                <button type="button" onClick={() => void handleTestSaved(item.id)} disabled={testing === item.id}>
                  {testing === item.id ? '测试中...' : '测试'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleRevealApiKey(item.id)}
                  disabled={loadingApiKeyId === item.id}
                >
                  {loadingApiKeyId === item.id ? '读取中...' : '查看Key'}
                </button>
                <button type="button" onClick={() => handleEdit(item)}>
                  编辑
                </button>
                <button type="button" onClick={() => handleDelete(item.id)}>
                  删除
                </button>
                {revealedApiKeys[item.id] && (
                  <code style={{ maxWidth: 220, overflowX: 'auto', whiteSpace: 'nowrap' }}>
                    {revealedApiKeys[item.id]}
                  </code>
                )}
              </span>
            </div>
          ))}
          {models.length === 0 && !loading && (
            <div className="row wide-row">
              <span style={{ textAlign: 'center', color: '#888', gridColumn: '1 / -1' }}>暂无配置，请先添加模型</span>
            </div>
          )}
        </div>
      </article>
    </section>
  )
}
