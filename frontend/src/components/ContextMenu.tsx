import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from './Icon'
import styles from './ContextMenu.module.css'

export type MenuItem =
  | 'separator'
  | {
      label: string
      icon?: IconName
      shortcut?: string
      disabled?: boolean
      danger?: boolean
      onClick: () => void
    }

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  // 靠近屏幕边缘时往回收,和系统菜单一样不出界
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    const left = Math.max(4, Math.min(x, window.innerWidth - rect.width - 4))
    const top = y + rect.height > window.innerHeight - 4 ? Math.max(4, y - rect.height) : y
    setPosition({ left, top })
  }, [x, y])

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        onClose()
      }
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      className={styles.menu}
      style={position}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) =>
        item === 'separator' ? (
          <div key={`sep-${index}`} className={styles.separator} />
        ) : (
          <button
            key={item.label}
            className={`${styles.item} ${item.danger ? styles.danger : ''}`}
            disabled={item.disabled}
            onClick={() => {
              onClose()
              item.onClick()
            }}
          >
            <span className={styles.icon}>{item.icon ? <Icon name={item.icon} size={15} /> : null}</span>
            <span className={styles.label}>{item.label}</span>
            {item.shortcut ? <span className={styles.shortcut}>{item.shortcut}</span> : null}
          </button>
        ),
      )}
    </div>,
    document.body,
  )
}

// 去掉首尾和连续的分隔线(某些菜单项按条件隐藏后会出现)
export function tidyMenu(items: (MenuItem | false | null | undefined)[]): MenuItem[] {
  const result: MenuItem[] = []
  for (const item of items) {
    if (!item) continue
    if (item === 'separator' && (result.length === 0 || result[result.length - 1] === 'separator')) continue
    result.push(item)
  }
  while (result[result.length - 1] === 'separator') result.pop()
  return result
}
