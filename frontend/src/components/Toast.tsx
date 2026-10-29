import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'
import styles from './Toast.module.css'

type Kind = 'success' | 'error' | 'info'

interface Item {
  id: number
  kind: Kind
  text: string
}

interface ToastApi {
  success: (text: string) => void
  error: (text: string) => void
  info: (text: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((item) => item.id !== id))
  }, [])

  const push = useCallback(
    (kind: Kind, text: string) => {
      const id = nextId.current++
      // 最多同时显示 5 条,错误多停留一会儿
      setItems((list) => [...list.slice(-4), { id, kind, text }])
      window.setTimeout(() => dismiss(id), kind === 'error' ? 6000 : 3000)
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(
    () => ({
      success: (text) => push('success', text),
      error: (text) => push('error', text),
      info: (text) => push('info', text),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.stack}>
        {items.map((item) => (
          <div key={item.id} className={`${styles.toast} ${styles[item.kind]}`} onClick={() => dismiss(item.id)}>
            <Icon name={item.kind === 'success' ? 'check' : item.kind === 'error' ? 'alert' : 'info'} size={16} />
            <span>{item.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast 必须在 ToastProvider 里使用')
  return api
}
