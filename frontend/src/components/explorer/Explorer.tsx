import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { Entry, Host } from '../../api/types'
import { onRefresh } from '../../state/refresh'
import { filesFromInput } from '../../utils/browser'
import { useLocalState } from '../../utils/browser'
import { resolvePath } from '../../utils/path'
import { ContextMenu, type MenuItem } from '../ContextMenu'
import { useToast } from '../Toast'
import { ActionBar } from './ActionBar'
import type { AddressHandle } from './AddressBar'
import { ConnectionView } from './ConnectionView'
import type { ExplorerContext } from './context'
import { useDragDrop } from './dnd'
import { ExplorerModals } from './ExplorerModals'
import { FileView } from './FileView'
import { blankMenu, itemMenu, type MenuDeps } from './menus'
import { StatusBar } from './StatusBar'
import { Toolbar } from './Toolbar'
import { sortEntries, type ModalState, type Sort, type SortKey, type ViewMode } from './types'
import { useDirectory } from './useDirectory'
import { useFileActions } from './useFileActions'
import { useKeyboard } from './useKeyboard'
import { useSelection } from './useSelection'
import { useTransfer } from './useTransfer'
import styles from './Explorer.module.css'

interface Props {
  host: Host
  active: boolean
  initialPath: string
  navSeq: number
  onPathChange: (path: string, home: string) => void
  onAddBookmark: (path: string) => void
  onEditHost: () => void
}

export function Explorer({ host, active, initialPath, navSeq, onPathChange, onAddBookmark, onEditHost }: Props) {
  const toast = useToast()
  const selection = useSelection()
  const dir = useDirectory(host, selection, toast.error)
  const [view, setView] = useLocalState<ViewMode>('sfb.view', 'details')
  const [sort, setSort] = useLocalState<Sort>('sfb.sort', { key: 'name', asc: true })
  const [showHidden, setShowHidden] = useLocalState('sfb.hidden', true)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const origin = useRef(Math.random().toString(36).slice(2)).current
  const listRef = useRef<HTMLDivElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const addressHandle = useRef<AddressHandle | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)

  const source = dir.search ? dir.search.entries : dir.entries
  const visible = useMemo(() => source.filter((entry) => showHidden || !entry.name.startsWith('.')), [source, showHidden])
  const items = useMemo(() => sortEntries(visible, sort), [visible, sort])
  const selectedEntries = items.filter((entry) => selection.selected.has(entry.path))

  const ctx: ExplorerContext = { host, origin, dir, selection, selectedEntries, setRenaming, setModal, onAddBookmark }
  const actions = useFileActions(ctx)
  const transfer = useTransfer(ctx)
  const dnd = useDragDrop({ hostId: host.id, cwd: dir.cwd, searching: !!dir.search, selection, onDrop: transfer.drop })
  const cutPaths = useMemo(
    () => new Set(transfer.clipboard?.mode === 'cut' && transfer.clipboard.hostId === host.id ? transfer.clipboard.paths : []),
    [transfer.clipboard, host.id],
  )

  // 只在挂载时连接一次;换服务器时外层会换 key 重新挂载
  const dirRef = useRef(dir)
  dirRef.current = dir
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    void dirRef.current.connect(initialPath)
  }, [initialPath])

  // 侧栏"快速访问"点击后 navSeq 递增
  const handledSeq = useRef(navSeq)
  useEffect(() => {
    const current = dirRef.current
    if (navSeq === handledSeq.current || !current.info) return
    handledSeq.current = navSeq
    void current.openDir(resolvePath(initialPath || '~', current.cwd, current.info.home))
  }, [navSeq, initialPath])

  const pathChange = useRef(onPathChange)
  pathChange.current = onPathChange
  useEffect(() => {
    if (dir.cwd) pathChange.current(dir.cwd, dir.info?.home ?? '')
  }, [dir.cwd, dir.info])

  // 其它标签页或后台任务改了这个目录,自动刷新
  const refreshTimer = useRef(0)
  useEffect(
    () =>
      onRefresh((detail) => {
        const current = dirRef.current
        if (detail.hostId !== host.id || detail.origin === origin) return
        const watching = current.search ? detail.dir.startsWith(current.search.root) : detail.dir === current.cwd
        if (!watching) return
        window.clearTimeout(refreshTimer.current)
        refreshTimer.current = window.setTimeout(() => dirRef.current.refresh(), 150)
      }),
    [host.id, origin],
  )

  const scrollTo = (path: string) => {
    listRef.current?.querySelector(`[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  // 目录加载完把选中的项目滚动到可见范围(比如返回上级时选中的来源文件夹)
  useEffect(() => {
    const first = [...selection.selected][0]
    if (first) listRef.current?.querySelector(`[data-path="${CSS.escape(first)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [dir.entries, selection])

  const columns = () => {
    if (view === 'details') return 1
    const tiles = listRef.current?.querySelectorAll<HTMLElement>('[data-path]')
    if (!tiles || tiles.length === 0) return 1
    const top = tiles[0].offsetTop
    let count = 0
    for (const tile of tiles) {
      if (tile.offsetTop !== top) break
      count++
    }
    return Math.max(1, count)
  }

  const startRename = (entry?: Entry) => {
    const target = entry ?? (selectedEntries.length === 1 ? selectedEntries[0] : null)
    if (target) setRenaming(target.path)
  }

  const pickUpload = (folder: boolean) => (folder ? folderInput : fileInput).current?.click()

  useKeyboard({
    active,
    blocked: renaming !== null || menu !== null,
    items,
    columns,
    selection,
    dir,
    open: actions.open,
    remove: () => void actions.remove(selectedEntries),
    rename: () => startRename(),
    copy: () => transfer.setClipboard('copy', selectedEntries),
    cut: () => transfer.setClipboard('cut', selectedEntries),
    paste: () => transfer.paste(),
    newFolder: () => void actions.create('folder'),
    focusSearch: () => searchInput.current?.focus(),
    focusAddress: () => addressHandle.current?.edit(),
    scrollTo,
  })

  const menuDeps: MenuDeps = {
    cwd: dir.cwd,
    info: dir.info,
    searching: !!dir.search,
    view,
    showHidden,
    actions,
    transfer,
    setView,
    setShowHidden,
    selectAll: () => selection.selectAll(items),
    refresh: () => dir.refresh(),
    pickUpload,
    startRename,
  }

  const openMenu = (event: MouseEvent, build: () => MenuItem[]) => setMenu({ x: event.clientX, y: event.clientY, items: build() })

  if (dir.conn.kind !== 'ready') {
    return <ConnectionView host={host} conn={dir.conn} onRetry={() => void dir.connect(initialPath)} onTrust={dir.trust} onEditHost={onEditHost} />
  }

  const hiddenCount = source.length - visible.length
  const sortBy = (key: SortKey) => setSort({ key, asc: sort.key === key ? !sort.asc : true })

  return (
    <div className={styles.explorer}>
      <Toolbar dir={dir} home={dir.info?.home ?? '/'} addressHandle={addressHandle} searchInput={searchInput} onBookmark={() => actions.bookmark(dir.cwd)} />
      <ActionBar
        selected={selectedEntries}
        info={dir.info}
        searching={!!dir.search}
        view={view}
        showHidden={showHidden}
        actions={actions}
        transfer={transfer}
        setView={setView}
        setShowHidden={setShowHidden}
        pickUpload={pickUpload}
        startRename={() => startRename()}
      />
      <FileView
        ref={listRef}
        items={items}
        view={view}
        sort={sort}
        onSort={sortBy}
        selection={selection}
        cutPaths={cutPaths}
        renaming={renaming}
        showLocation={!!dir.search}
        loading={dir.loading || !!dir.search?.loading}
        emptyText={dir.search ? '没有找到匹配的文件' : '此文件夹为空'}
        dnd={dnd}
        onOpen={actions.open}
        onItemMenu={(event) => openMenu(event, () => itemMenu(items.filter((entry) => selection.selected.has(entry.path)), menuDeps))}
        onBlankMenu={(event) => openMenu(event, () => blankMenu(menuDeps))}
        onRename={(entry, name) => (name === null ? setRenaming(null) : void actions.rename(entry, name))}
      />
      <StatusBar host={host} info={dir.info} items={items} selected={selectedEntries} hiddenCount={hiddenCount} truncated={!!dir.search?.truncated} />
      <input ref={fileInput} type="file" multiple hidden onChange={(event) => {
        if (event.target.files) void transfer.upload(filesFromInput(event.target.files))
        event.target.value = ''
      }} />
      <input ref={folderInput} type="file" hidden {...{ webkitdirectory: '' }} onChange={(event) => {
        if (event.target.files) void transfer.upload(filesFromInput(event.target.files))
        event.target.value = ''
      }} />
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
      <ExplorerModals host={host} info={dir.info} cwd={dir.cwd} items={items} modal={modal} setModal={setModal} actions={actions} />
    </div>
  )
}
