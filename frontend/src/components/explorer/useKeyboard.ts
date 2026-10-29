import { useEffect, useRef } from 'react'
import type { Entry } from '../../api/types'
import { hasOpenModal } from '../Modal'
import type { DirectoryApi } from './useDirectory'
import type { SelectionApi } from './useSelection'

export interface KeyHandlers {
  active: boolean
  blocked: boolean // 正在重命名、菜单打开等
  items: Entry[]
  columns: () => number
  selection: SelectionApi
  dir: DirectoryApi
  open: (entry: Entry) => void
  remove: () => void
  rename: () => void
  copy: () => void
  cut: () => void
  paste: () => void
  newFolder: () => void
  focusSearch: () => void
  focusAddress: () => void
  scrollTo: (path: string) => void
}

function navTarget(key: string, columns: number, count: number, current: number): number | null {
  if (key === 'ArrowDown') return current < 0 ? 0 : current + columns
  if (key === 'ArrowUp') return current < 0 ? 0 : current - columns
  if (key === 'ArrowRight' && columns > 1) return current + 1
  if (key === 'ArrowLeft' && columns > 1) return current - 1
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

// 快捷键基本与 Windows 资源管理器一致;输入框里打字时不拦截
export function useKeyboard(handlers: KeyHandlers) {
  const ref = useRef(handlers)
  ref.current = handlers
  const typeahead = useRef({ text: '', time: 0 })

  useEffect(() => {
    if (!handlers.active) return
    const onKey = (event: KeyboardEvent) => {
      const current = ref.current
      if (event.defaultPrevented || hasOpenModal() || current.blocked) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      const { items, selection, dir } = current
      const ctrl = event.ctrlKey || event.metaKey
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
      const handled = () => event.preventDefault()
      const run = (action: () => void) => {
        event.preventDefault()
        action()
      }

      if (key === 'F5') return run(dir.refresh)
      if (event.altKey && key === 'ArrowLeft') return run(dir.back)
      if (event.altKey && key === 'ArrowRight') return run(dir.forward)
      if (event.altKey && key === 'ArrowUp') return run(dir.up)
      if (key === 'Backspace') return run(dir.canBack ? dir.back : dir.up)
      if ((ctrl && key === 'f') || key === 'F3') return run(current.focusSearch)
      if ((ctrl && key === 'l') || (event.altKey && key === 'd')) return run(current.focusAddress)
      if (ctrl && event.shiftKey && key === 'n') return run(current.newFolder)
      if (ctrl && key === 'a') return run(() => selection.selectAll(items))
      // 页面上选中了文字时,Ctrl+C 留给浏览器复制文字
      if (ctrl && key === 'c' && !window.getSelection()?.toString()) return run(current.copy)
      if (ctrl && key === 'x') return run(current.cut)
      if (ctrl && key === 'v') return run(current.paste)
      if (key === 'Delete') return run(current.remove)
      if (key === 'F2') return run(current.rename)
      if (key === 'Escape') return dir.search ? dir.clearSearch() : selection.clear()
      if (key === 'Enter') {
        const entry = items.find((item) => item.path === selection.focus && selection.selected.has(item.path)) ??
          items.find((item) => selection.selected.has(item.path))
        if (entry) {
          handled()
          current.open(entry)
        }
        return
      }
      if (ctrl || event.altKey) return
      const next = navTarget(event.key, current.columns(), items.length, selection.focusIndex(items))
      if (next !== null) {
        handled()
        const path = selection.moveFocus(items, next, event.shiftKey)
        if (path) current.scrollTo(path)
        return
      }
      if (key.length !== 1 || key === ' ') return
      // 输入首字母跳转;连续输入匹配前缀,重复同一个字母则循环
      const now = Date.now()
      const state = typeahead.current
      state.text = now - state.time > 800 ? key : state.text + key
      state.time = now
      const start = selection.focusIndex(items) + (state.text.length === 1 ? 1 : 0)
      const ordered = [...items.slice(Math.max(0, start)), ...items.slice(0, Math.max(0, start))]
      const match = ordered.find((item) => item.name.toLowerCase().startsWith(state.text))
      if (match) {
        handled()
        selection.replace([match.path])
        current.scrollTo(match.path)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handlers.active])
}
