const defaultBaseUrl = 'http://127.0.0.1:8000'

export const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? defaultBaseUrl

type HttpOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  userId: number
  body?: unknown
  formData?: FormData
}

export async function requestJson<T>(path: string, options: HttpOptions): Promise<T> {
  const { method = 'GET', userId, body, formData } = options
  const headers: Record<string, string> = {
    'X-User-Id': String(userId),
  }
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

export async function requestRaw(path: string, options: HttpOptions): Promise<Response> {
  const { method = 'GET', userId, body, formData } = options
  const headers: Record<string, string> = {
    'X-User-Id': String(userId),
  }
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

