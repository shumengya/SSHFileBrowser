import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import styles from './Modal.module.css'

// 弹窗栈:只有最上层响应 Esc;文件列表的快捷键在有弹窗时也要停用
const stack: number[] = []
let nextId = 1

export function hasOpenModal(): boolean {
  return stack.length > 0
}

interface Props {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number | string
  height?: number | string
  bodyClassName?: string
  // 编辑器自己处理 Esc(有未保存内容时要确认)
  closeOnEscape?: boolean
}

export function Modal({ title, onClose, children, footer, width = 460, height, bodyClassName, closeOnEscape = true }: Props) {
  const idRef = useRef(0)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const id = nextId++
    idRef.current = id
    stack.push(id)
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || stack[stack.length - 1] !== id || !closeOnEscape) return
      event.preventDefault()
      // 捕获阶段拦下,文件列表的 Esc(取消选择、退出搜索)不会被同时触发
      event.stopImmediatePropagation()
      closeRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      stack.splice(stack.indexOf(id), 1)
    }
  }, [closeOnEscape])

  return createPortal(
    <div className={styles.backdrop} onMouseDown={(event) => event.stopPropagation()}>
      <div className={styles.dialog} style={{ width, height }} role="dialog" aria-modal="true">
        <div className={styles.header}>
          <div className={styles.title}>{title}</div>
          <button className={styles.close} onClick={onClose} title="关闭 (Esc)">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className={bodyClassName ?? styles.body}>{children}</div>
        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}
