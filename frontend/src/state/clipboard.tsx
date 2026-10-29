import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

// 应用内剪贴板,跨标签页、跨服务器共享:在 A 服务器复制,到 B 服务器粘贴
export interface ClipboardData {
  mode: 'copy' | 'cut'
  hostId: number
  hostName: string
  paths: string[]
}

interface ClipboardApi {
  data: ClipboardData | null
  set: (data: ClipboardData | null) => void
}

const ClipboardContext = createContext<ClipboardApi | null>(null)

export function ClipboardProvider({ children }: { children: ReactNode }) {
  const [data, set] = useState<ClipboardData | null>(null)
  const api = useMemo(() => ({ data, set }), [data])
  return <ClipboardContext.Provider value={api}>{children}</ClipboardContext.Provider>
}

export function useClipboard(): ClipboardApi {
  const api = useContext(ClipboardContext)
  if (!api) throw new Error('useClipboard 必须在 ClipboardProvider 里使用')
  return api
}
