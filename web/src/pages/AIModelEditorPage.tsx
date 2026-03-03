import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

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

function resolveBackPath(rawBack: string | null): string {
  if (!rawBack) {
    return '/ai-models'
  }
  try {
    const decoded = decodeURIComponent(rawBack)
    if (decoded.startsWith('/ai-models')) {
      return decoded
    }
    return '/ai-models'
  } catch {
    return '/ai-models'
  }
}

function mapModelToForm(model: AIModel): ModelForm {
  return {
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
  }
}

export function AIModelEditorPage({ userId }: Props) {
  const toast = useToast()
  const navigate = useNavigate()
  const { modelId } = useParams<{ modelId: string }>()
  const [searchParams] = useSearchParams()
  const backPath = useMemo(() => resolveBackPath(searchParams.get('back')), [searchParams])

  const editingId = useMemo(() => {
    if (!modelId) return null
    const parsed = Number(modelId)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }, [modelId])
  const isEditMode = editingId !== null

  const [form, setForm] = useState<ModelForm>(defaultForm)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (!isEditMode || editingId === null) {
      return
    }
    let active = true
    setLoading(true)
    requestJson<AIModel[]>('/ai/models', { userId })
      .then((rows) => {
        if (!active) return
        const target = rows.find((item) => item.id === editingId)
        if (!target) {
          toast.error(`模型 #${editingId} 不存在或无权限访问`)
          navigate(backPath, { replace: true })
          return
        }
        setForm(mapModelToForm(target))
      })
      .catch((err) => {
        if (!active) return
        toast.error(err instanceof Error ? err.message : '加载模型失败')
      })
      .finally(() => {
        if (!active) return
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [backPath, editingId, isEditMode, navigate, toast, userId])

  const handleProviderChange = (provider: AIProvider) => {
    const opt = providerOptions.find((item) => item.value === provider)
    setForm((prev) => ({
      ...prev,
      provider,
      api_base_url: opt?.defaultUrl || '',
      model: opt?.defaultModel || '',
    }))
  }

  const handleTestForm = async () => {
    if (!form.api_base_url.trim() || !form.api_key.trim() || !form.model.trim()) {
      toast.error('请先填写 API 地址、API Key 和模型名称')
      return
    }
    setTesting(true)
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
      setTesting(false)
    }
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!form.name.trim()) {
      toast.error('请输入模型名称')
      return
    }
    if (!form.api_base_url.trim()) {
      toast.error('请输入 API 地址')
      return
    }
    if (!form.model.trim()) {
      toast.error('请输入模型名称')
      return
    }

    try {
      setSaving(true)
      const body: Record<string, unknown> = { ...form }
      if (!body.api_key) {
        delete body.api_key
      }

      if (editingId !== null) {
        await requestJson(`/ai/models/${editingId}`, { method: 'PUT', userId, body })
        toast.success('模型已更新')
      } else {
        await requestJson('/ai/models', { method: 'POST', userId, body })
        toast.success('模型已创建')
      }
      navigate(backPath, { replace: true })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="page-wrap">
      <header className="page-head">
        <h2>{isEditMode ? `编辑模型 #${editingId}` : '新增模型'}</h2>
        <p>使用独立页面维护模型配置；保存后返回模型列表。</p>
      </header>

      {loading ? (
        <article className="panel">
          <p>加载中...</p>
        </article>
      ) : (
        <form className="panel form-grid" onSubmit={handleSubmit}>
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
              placeholder={isEditMode ? '(留空表示不修改)' : '请输入 API Key'}
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
          <div className="checks wide">
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
            <button type="button" onClick={() => navigate(backPath)} disabled={saving || testing}>
              返回列表
            </button>
            <button type="button" onClick={() => void handleTestForm()} disabled={testing || saving}>
              {testing ? '测试中...' : '测试连接'}
            </button>
            <button className="primary-btn" type="submit" disabled={saving || testing}>
              {saving ? '保存中...' : isEditMode ? '更新模型' : '创建模型'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
