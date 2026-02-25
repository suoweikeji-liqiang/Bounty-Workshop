const defaultBaseUrl = 'http://localhost:8000'
const authTokenStorageKey = 'bw_access_token'

export const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? defaultBaseUrl

export type HttpOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  userId?: number
  body?: unknown
  formData?: FormData
  token?: string
}

export function getStoredAuthToken(): string | null {
  return localStorage.getItem(authTokenStorageKey)
}

export function setStoredAuthToken(token: string | null): void {
  if (token) {
    localStorage.setItem(authTokenStorageKey, token)
    return
  }
  localStorage.removeItem(authTokenStorageKey)
}

function buildHeaders(options: HttpOptions): Record<string, string> {
  const headers: Record<string, string> = {}
  const token = options.token ?? getStoredAuthToken()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  if (typeof options.userId === 'number' && Number.isFinite(options.userId)) {
    headers['X-User-Id'] = String(options.userId)
  }
  return headers
}

export async function requestJson<T>(path: string, options: HttpOptions): Promise<T> {
  const { method = 'GET', body, formData } = options
  const headers = buildHeaders(options)
  let payload: BodyInit | undefined
  if (formData) {
    payload = formData
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }

  const res = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers,
    body: payload,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${text}`)
  }

  if (res.status === 204) {
    return {} as T
  }

  return (await res.json()) as T
}

export async function downloadFile(path: string, filename: string, options: HttpOptions): Promise<void> {
  const headers = buildHeaders(options)
  const res = await fetch(`${apiBaseUrl}${path}`, { headers })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${text}`)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export async function requestRaw(path: string, options: HttpOptions): Promise<Response> {
  const { method = 'GET', body, formData } = options
  const headers = buildHeaders(options)
  let payload: BodyInit | undefined
  if (formData) {
    payload = formData
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }

  const res = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers,
    body: payload,
    redirect: 'manual',
  })
  return res
}
