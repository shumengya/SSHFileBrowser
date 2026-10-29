import { useCallback, useRef, useState } from 'react'
import { fsApi, hostApi } from '../../api'
import { ApiError, errorMessage, isCanceled } from '../../api/client'
import type { Entry, Host, HostInfo } from '../../api/types'
import type { SearchState } from './types'
import type { SelectionApi } from './useSelection'

export type ConnState =
  | { kind: 'connecting' }
  | { kind: 'ready'; info: HostInfo }
  | { kind: 'error'; message: string; fingerprint?: string }

interface OpenOptions {
  push?: boolean
  select?: string[]
  keepSelection?: boolean
  quiet?: boolean
}

// 目录浏览:连接、加载、前进后退、搜索。打开失败时停留在原目录,和资源管理器一样。
export function useDirectory(host: Host, selection: SelectionApi, onError: (message: string) => void) {
  const [conn, setConn] = useState<ConnState>({ kind: 'connecting' })
  const [cwd, setCwd] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<{ stack: string[]; index: number }>({ stack: [], index: -1 })
  const [search, setSearch] = useState<SearchState | null>(null)
  const loadSeq = useRef(0)
  const searchAbort = useRef<AbortController | null>(null)
  const cwdRef = useRef('')
  cwdRef.current = cwd

  const openDir = useCallback(
    async (path: string, options: OpenOptions = {}): Promise<boolean> => {
      const seq = ++loadSeq.current
      setLoading(true)
      try {
        const result = await fsApi.list(host.id, path)
        if (seq !== loadSeq.current) return false
        searchAbort.current?.abort()
        setSearch(null)
        setEntries(result.entries)
        setCwd(result.path)
        if (options.push !== false && result.path !== cwdRef.current) {
          setHistory((current) => {
            const stack = [...current.stack.slice(0, current.index + 1), result.path]
            return { stack, index: stack.length - 1 }
          })
        }
        if (options.select) selection.replace(options.select)
        else if (options.keepSelection) selection.retain(new Set(result.entries.map((entry) => entry.path)))
        else selection.clear()
        return true
      } catch (error) {
        if (seq !== loadSeq.current || isCanceled(error)) return false
        if (error instanceof ApiError && (error.code === 'CONNECT_FAILED' || error.code === 'HOSTKEY_MISMATCH')) {
          setConn({ kind: 'error', message: error.message, fingerprint: error.fingerprint })
        } else if (!options.quiet) {
          onError(errorMessage(error))
        }
        return false
      } finally {
        if (seq === loadSeq.current) setLoading(false)
      }
    },
    [host.id, selection, onError],
  )

  const runSearch = useCallback(
    async (keyword: string, keep = false) => {
      const root = cwdRef.current
      searchAbort.current?.abort()
      const controller = new AbortController()
      searchAbort.current = controller
      setSearch((current) => ({ keyword, root, entries: keep && current ? current.entries : [], truncated: false, loading: true }))
      if (!keep) selection.clear()
      try {
        const result = await fsApi.search(host.id, root, keyword, controller.signal)
        setSearch({ keyword, root, entries: result.entries, truncated: result.truncated, loading: false })
        if (keep) selection.retain(new Set(result.entries.map((entry) => entry.path)))
      } catch (error) {
        if (isCanceled(error)) return
        onError(errorMessage(error))
        setSearch((current) => (current ? { ...current, loading: false } : null))
      }
    },
    [host.id, selection, onError],
  )

  const clearSearch = useCallback(() => {
    searchAbort.current?.abort()
    setSearch(null)
    selection.clear()
  }, [selection])

  const searchRef = useRef(search)
  searchRef.current = search

  const refresh = useCallback(
    (select?: string[]) => {
      if (searchRef.current) {
        void runSearch(searchRef.current.keyword, true)
        return
      }
      if (cwdRef.current) void openDir(cwdRef.current, { push: false, keepSelection: !select, select })
    },
    [openDir, runSearch],
  )

  const go = async (offset: number) => {
    const index = history.index + offset
    const target = history.stack[index]
    if (target === undefined) return
    const ok = await openDir(target, { push: false })
    if (ok) setHistory((current) => ({ ...current, index }))
  }

  const up = () => {
    if (cwd === '/' || !cwd) return
    const parent = cwd.slice(0, cwd.lastIndexOf('/')) || '/'
    // 回到上级时选中刚才所在的文件夹,方便继续用键盘操作
    void openDir(parent, { select: [cwd] })
  }

  const connect = useCallback(
    async (startPath: string) => {
      setConn({ kind: 'connecting' })
      try {
        const result = await hostApi.connect(host.id)
        setConn({ kind: 'ready', info: result.info })
        const home = result.info.home
        const first = startPath || host.defaultDir || home
        const ok = await openDir(first, { quiet: first !== home })
        if (!ok && first !== home) {
          onError(`无法打开 ${first},已转到主目录`)
          await openDir(home)
        }
      } catch (error) {
        const apiError = error instanceof ApiError ? error : null
        setConn({ kind: 'error', message: errorMessage(error), fingerprint: apiError?.fingerprint })
      }
    },
    [host.id, host.defaultDir, openDir, onError],
  )

  const trust = async (fingerprint: string) => {
    await hostApi.trust(host.id, fingerprint)
    await connect(cwdRef.current)
  }

  return {
    conn,
    info: conn.kind === 'ready' ? conn.info : null,
    cwd,
    entries,
    loading,
    search,
    canBack: history.index > 0,
    canForward: history.index < history.stack.length - 1,
    openDir,
    refresh,
    runSearch,
    clearSearch,
    back: () => void go(-1),
    forward: () => void go(1),
    up,
    connect,
    trust,
  }
}

export type DirectoryApi = ReturnType<typeof useDirectory>
