/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

type ToastType = 'success' | 'error' | 'info'

type ToastItem = {
  id: number
  type: ToastType
  message: string
}

type ToastApi = {
  push: (type: ToastType, message: string, durationMs?: number) => void
  success: (message: string, durationMs?: number) => void
  error: (message: string, durationMs?: number) => void
  info: (message: string, durationMs?: number) => void
}

const ToastContext = createContext<ToastApi | null>(null)

type ToastProviderProps = {
  children: ReactNode
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [items, setItems] = useState<ToastItem[]>([])
  const idRef = useRef(0)

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const push = useCallback(
    (type: ToastType, message: string, durationMs = 3200) => {
      const text = message.trim()
      if (!text) {
        return
      }
      const id = idRef.current + 1
      idRef.current = id
      setItems((prev) => [...prev.slice(-3), { id, type, message: text }])
      window.setTimeout(() => {
        remove(id)
      }, durationMs)
    },
    [remove],
  )

  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (message, durationMs) => push('success', message, durationMs),
      error: (message, durationMs) => push('error', message, durationMs),
      info: (message, durationMs) => push('info', message, durationMs),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite" aria-atomic="true">
        {items.map((item) => (
          <div key={item.id} className={`toast-card toast-${item.type}`}>
            <p>{item.message}</p>
            <button type="button" onClick={() => remove(item.id)} aria-label="close toast">
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return context
}
