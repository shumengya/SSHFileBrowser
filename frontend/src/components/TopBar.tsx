import { useState } from 'react'
import type { Host } from '../api/types'
import { useTasks } from '../state/tasks'
import { basename } from '../utils/path'
import { ContextMenu } from './ContextMenu'
import { Icon } from './Icon'
import type { Tab } from './Workspace'
import styles from './TopBar.module.css'

interface Props {
  tabs: Tab[]
  hosts: Host[]
  activeId: string
  username: string
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onAdd: () => void
  onChangePassword: () => void
  onLogout: () => void
}

export function TopBar({ tabs, hosts, activeId, username, onSelect, onClose, onAdd, onChangePassword, onLogout }: Props) {
  const tasks = useTasks()
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const titleOf = (tab: Tab) => {
    const host = hosts.find((item) => item.id === tab.hostId)
    if (!host) return '新标签页'
    if (!tab.path) return host.name
    return `${basename(tab.path)} - ${host.name}`
  }

  return (
    <header className={styles.bar}>
      <div className={styles.brand}>
        <Icon name="server" size={16} />
        <span>SSH 文件管理器</span>
      </div>
      <div className={styles.tabs}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`${styles.tab} ${tab.id === activeId ? styles.active : ''}`}
            onMouseDown={(event) => {
              // 中键关闭,和浏览器一致
              if (event.button === 1) {
                event.preventDefault()
                onClose(tab.id)
                return
              }
              if (event.button === 0) onSelect(tab.id)
            }}
            title={tab.path || titleOf(tab)}
          >
            <Icon name={tab.hostId ? 'hardDrive' : 'home'} size={14} />
            <span className={styles.tabTitle}>{titleOf(tab)}</span>
            <button
              className={styles.tabClose}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => onClose(tab.id)}
              title="关闭标签页"
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
        <button className={styles.add} onClick={onAdd} title="新标签页">
          <Icon name="plus" size={16} />
        </button>
      </div>
      <div className={styles.actions}>
        <button
          className={`${styles.action} ${tasks.panelOpen ? styles.actionOn : ''}`}
          onClick={() => tasks.setPanelOpen(!tasks.panelOpen)}
          title="传输与任务"
        >
          <Icon name="tasks" size={16} />
          {tasks.activeCount > 0 ? <span className={styles.badge}>{tasks.activeCount}</span> : null}
        </button>
        <button
          className={styles.action}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            setMenu({ x: rect.right - 200, y: rect.bottom + 4 })
          }}
        >
          <Icon name="user" size={16} />
          <span className={styles.username}>{username}</span>
        </button>
      </div>
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: '修改密码', icon: 'key', onClick: onChangePassword },
            'separator',
            { label: '退出登录', icon: 'logout', onClick: onLogout },
          ]}
        />
      ) : null}
    </header>
  )
}
