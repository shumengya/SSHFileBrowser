import { useState } from 'react'
import type { Bookmark, Host } from '../api/types'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { Icon } from './Icon'
import styles from './Sidebar.module.css'

interface Props {
  hosts: Host[]
  activeHost: Host | null
  currentPath: string
  homePath: string
  bookmarks: Bookmark[]
  onOpenHost: (hostId: number, inNewTab?: boolean) => void
  onNavigate: (path: string) => void
  onAddHost: () => void
  onEditHost: (host: Host) => void
  onDeleteHost: (host: Host) => void
  onRemoveBookmark: (bookmark: Bookmark) => void
}

export function Sidebar(props: Props) {
  const { hosts, activeHost, currentPath, homePath, bookmarks } = props
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)

  const hostMenu = (event: React.MouseEvent, host: Host) => {
    event.preventDefault()
    setMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { label: '打开', icon: 'folderPlus', onClick: () => props.onOpenHost(host.id) },
        { label: '在新标签页中打开', icon: 'plus', onClick: () => props.onOpenHost(host.id, true) },
        'separator',
        { label: '编辑连接', icon: 'edit', onClick: () => props.onEditHost(host) },
        { label: '删除', icon: 'trash', danger: true, onClick: () => props.onDeleteHost(host) },
      ],
    })
  }

  const place = (label: string, path: string, icon: 'home' | 'hardDrive' | 'star', bookmark?: Bookmark) => (
    <button
      key={bookmark ? `b-${bookmark.id}` : label}
      className={`${styles.item} ${currentPath === (path === '~' ? homePath : path) ? styles.current : ''}`}
      onClick={() => props.onNavigate(path)}
      title={path === '~' ? '主目录' : path}
      onContextMenu={(event) => {
        if (!bookmark) return
        event.preventDefault()
        setMenu({
          x: event.clientX,
          y: event.clientY,
          items: [
            { label: '打开', icon: 'folderPlus', onClick: () => props.onNavigate(path) },
            { label: '从快速访问中取消固定', icon: 'star', onClick: () => props.onRemoveBookmark(bookmark) },
          ],
        })
      }}
    >
      <Icon name={icon} size={16} className={styles.itemIcon} />
      <span className={styles.itemText}>{label}</span>
      {bookmark ? (
        <span
          className={styles.remove}
          title="取消固定"
          onClick={(event) => {
            event.stopPropagation()
            props.onRemoveBookmark(bookmark)
          }}
        >
          <Icon name="close" size={12} />
        </span>
      ) : null}
    </button>
  )

  return (
    <nav className={styles.sidebar}>
      {activeHost ? (
        <div className={styles.section}>
          <div className={styles.heading}>
            <span>快速访问</span>
          </div>
          {place('主目录', '~', 'home')}
          {place('根目录 /', '/', 'hardDrive')}
          {bookmarks.map((bookmark) => place(bookmark.name, bookmark.path, 'star', bookmark))}
        </div>
      ) : null}
      <div className={styles.section}>
        <div className={styles.heading}>
          <span>服务器</span>
          <button className={styles.headingButton} onClick={props.onAddHost} title="添加服务器">
            <Icon name="plus" size={14} />
          </button>
        </div>
        {hosts.length === 0 ? <div className={styles.empty}>还没有服务器,点 + 添加</div> : null}
        {hosts.map((host) => (
          <button
            key={host.id}
            className={`${styles.serverItem} ${activeHost?.id === host.id ? styles.current : ''}`}
            onClick={() => props.onOpenHost(host.id)}
            onAuxClick={(event) => {
              if (event.button === 1) props.onOpenHost(host.id, true)
            }}
            onContextMenu={(event) => hostMenu(event, host)}
            title={`${host.username}@${host.address}:${host.port}`}
          >
            <Icon name="server" size={16} className={styles.itemIcon} />
            <span className={styles.itemText}>
              {host.name}
              <span className={styles.itemSub}>
                {host.username}@{host.address}
              </span>
            </span>
          </button>
        ))}
      </div>
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
    </nav>
  )
}
