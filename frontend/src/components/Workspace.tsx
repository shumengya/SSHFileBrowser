import { useCallback, useEffect, useState } from 'react'
import { authApi, bookmarkApi, hostApi } from '../api'
import { errorMessage } from '../api/client'
import type { Bookmark, Host } from '../api/types'
import { useDialog } from './Dialogs'
import { useToast } from './Toast'
import { TopBar } from './TopBar'
import { Sidebar } from './Sidebar'
import { HostDialog } from './HostDialog'
import { PasswordDialog } from './PasswordDialog'
import { TaskCenter } from './TaskCenter'
import { Welcome } from './Welcome'
import { Explorer } from './explorer/Explorer'
import ui from '../styles/ui.module.css'
import styles from './Workspace.module.css'

export interface Tab {
  id: string
  hostId: number | null
  path: string
  // 服务器主目录,侧栏据此高亮「主目录」
  home?: string
  // 改变 key 会让 Explorer 重新挂载(切换服务器、服务器配置变了)
  key: number
  // 侧栏点击导航时递增,Explorer 据此跳转
  navSeq: number
}

const STORAGE_KEY = 'sfb.tabs'

const newTab = (hostId: number | null = null, path = ''): Tab => ({
  id: Math.random().toString(36).slice(2, 10),
  hostId,
  path,
  key: Date.now(),
  navSeq: 0,
})

function loadTabs(hosts: Host[]): { tabs: Tab[]; activeId: string } {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as { tabs: Tab[]; activeId: string } | null
    if (saved && Array.isArray(saved.tabs) && saved.tabs.length > 0) {
      const ids = new Set(hosts.map((host) => host.id))
      const tabs = saved.tabs.map((tab) => ({ ...tab, hostId: tab.hostId && ids.has(tab.hostId) ? tab.hostId : null, navSeq: 0 }))
      const activeId = tabs.some((tab) => tab.id === saved.activeId) ? saved.activeId : tabs[0].id
      return { tabs, activeId }
    }
  } catch {
    // 本地存储坏了就当没有
  }
  const tab = newTab()
  return { tabs: [tab], activeId: tab.id }
}

interface Props {
  username: string
  onLogout: () => void
}

export function Workspace({ username, onLogout }: Props) {
  const toast = useToast()
  const dialog = useDialog()
  const [hosts, setHosts] = useState<Host[] | null>(null)
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeId, setActiveId] = useState('')
  const [bookmarks, setBookmarks] = useState<Record<number, Bookmark[]>>({})
  const [hostDialog, setHostDialog] = useState<{ host: Host | null } | null>(null)
  const [passwordOpen, setPasswordOpen] = useState(false)

  useEffect(() => {
    hostApi
      .list()
      .then((list) => {
        setHosts(list)
        const restored = loadTabs(list)
        setTabs(restored.tabs)
        setActiveId(restored.activeId)
      })
      .catch((error: unknown) => {
        toast.error(errorMessage(error))
        setHosts([])
      })
  }, [toast])

  useEffect(() => {
    if (tabs.length > 0) localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs, activeId }))
  }, [tabs, activeId])

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? null
  const activeHost = hosts?.find((host) => host.id === activeTab?.hostId) ?? null

  const loadBookmarks = useCallback((hostId: number) => {
    bookmarkApi
      .list(hostId)
      .then((list) => setBookmarks((all) => ({ ...all, [hostId]: list })))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (activeHost && !bookmarks[activeHost.id]) loadBookmarks(activeHost.id)
  }, [activeHost, bookmarks, loadBookmarks])

  const updateTab = useCallback((id: string, patch: Partial<Tab>) => {
    setTabs((list) => list.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)))
  }, [])

  const openHost = (hostId: number, inNewTab = false) => {
    if (inNewTab || !activeTab) {
      const tab = newTab(hostId)
      setTabs((list) => [...list, tab])
      setActiveId(tab.id)
      return
    }
    if (activeTab.hostId === hostId) {
      updateTab(activeTab.id, { path: '', navSeq: activeTab.navSeq + 1 })
      return
    }
    updateTab(activeTab.id, { hostId, path: '', key: Date.now() })
  }

  const navigate = (path: string) => {
    if (!activeTab) return
    updateTab(activeTab.id, { path, navSeq: activeTab.navSeq + 1 })
  }

  const addTab = () => {
    // 新标签页沿用当前服务器和目录,和资源管理器一样
    const tab = newTab(activeTab?.hostId ?? null, activeTab?.path ?? '')
    setTabs((list) => [...list, tab])
    setActiveId(tab.id)
  }

  const closeTab = (id: string) => {
    const index = tabs.findIndex((tab) => tab.id === id)
    const rest = tabs.filter((tab) => tab.id !== id)
    if (rest.length === 0) {
      const tab = newTab()
      setTabs([tab])
      setActiveId(tab.id)
      return
    }
    setTabs(rest)
    if (id === activeId) setActiveId(rest[Math.max(0, index - 1)].id)
  }

  const onHostSaved = (saved: Host, previous: Host | null) => {
    setHosts((list) => {
      const rest = (list ?? []).filter((host) => host.id !== saved.id)
      return [...rest, saved].sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id)
    })
    setHostDialog(null)
    if (!previous) {
      openHost(saved.id)
      return
    }
    // 连接参数变了,打开着的标签页重新连接
    setTabs((list) => list.map((tab) => (tab.hostId === saved.id ? { ...tab, key: Date.now() } : tab)))
  }

  const deleteHost = async (host: Host) => {
    const ok = await dialog.confirm({
      title: '删除服务器',
      message: `确定删除「${host.name}」吗?只删除本地保存的连接信息,不会动服务器上的文件。`,
      okText: '删除',
      danger: true,
    })
    if (!ok) return
    try {
      await hostApi.remove(host.id)
      setHosts((list) => (list ?? []).filter((item) => item.id !== host.id))
      setTabs((list) => list.map((tab) => (tab.hostId === host.id ? { ...tab, hostId: null, path: '', key: Date.now() } : tab)))
      toast.success('已删除')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const addBookmark = async (hostId: number, path: string) => {
    if ((bookmarks[hostId] ?? []).some((item) => item.path === path)) {
      toast.info('已经在快速访问里了')
      return
    }
    try {
      const created = await bookmarkApi.create(hostId, '', path)
      setBookmarks((all) => ({ ...all, [hostId]: [...(all[hostId] ?? []), created] }))
      toast.success('已固定到快速访问')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const removeBookmark = async (bookmark: Bookmark) => {
    try {
      await bookmarkApi.remove(bookmark.hostId, bookmark.id)
      setBookmarks((all) => ({ ...all, [bookmark.hostId]: (all[bookmark.hostId] ?? []).filter((item) => item.id !== bookmark.id) }))
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const logout = async () => {
    try {
      await authApi.logout()
    } finally {
      onLogout()
    }
  }

  if (!hosts) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
        <span className={ui.spinner} />
      </div>
    )
  }

  return (
    <div className={styles.workspace}>
      <TopBar
        tabs={tabs}
        hosts={hosts}
        activeId={activeId}
        username={username}
        onSelect={setActiveId}
        onClose={closeTab}
        onAdd={addTab}
        onChangePassword={() => setPasswordOpen(true)}
        onLogout={logout}
      />
      <div className={styles.body}>
        <Sidebar
          hosts={hosts}
          activeHost={activeHost}
          currentPath={activeTab?.path ?? ''}
          homePath={activeTab?.home ?? ''}
          bookmarks={activeHost ? (bookmarks[activeHost.id] ?? []) : []}
          onOpenHost={openHost}
          onNavigate={navigate}
          onAddHost={() => setHostDialog({ host: null })}
          onEditHost={(host) => setHostDialog({ host })}
          onDeleteHost={deleteHost}
          onRemoveBookmark={removeBookmark}
        />
        <main className={styles.main}>
          {tabs.map((tab) => {
            const host = hosts.find((item) => item.id === tab.hostId)
            const visible = tab.id === activeId
            return (
              <div key={tab.id} className={styles.pane} style={{ display: visible ? 'flex' : 'none' }}>
                {host ? (
                  <Explorer
                    key={`${tab.hostId}-${tab.key}`}
                    host={host}
                    active={visible}
                    initialPath={tab.path}
                    navSeq={tab.navSeq}
                    onPathChange={(path, home) => updateTab(tab.id, { path, home })}
                    onAddBookmark={(path) => void addBookmark(host.id, path)}
                    onEditHost={() => setHostDialog({ host })}
                  />
                ) : (
                  <Welcome hosts={hosts} onOpen={(hostId) => openHost(hostId)} onAdd={() => setHostDialog({ host: null })} />
                )}
              </div>
            )
          })}
        </main>
      </div>
      <TaskCenter />
      {hostDialog ? (
        <HostDialog host={hostDialog.host} onClose={() => setHostDialog(null)} onSaved={(saved) => onHostSaved(saved, hostDialog.host)} />
      ) : null}
      {passwordOpen ? <PasswordDialog onClose={() => setPasswordOpen(false)} /> : null}
    </div>
  )
}
