import { useCallback, useRef, useState, type MouseEvent } from 'react'
import type { Entry } from '../../api/types'

// 选择逻辑照搬 Windows 资源管理器:单击、Ctrl 多选、Shift 连选、框选、方向键
export function useSelection() {
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const marqueeBase = useRef<Set<string>>(new Set())

  const replace = useCallback((paths: string[]) => {
    setSelected(new Set(paths))
    setAnchor(paths[0] ?? null)
    setFocus(paths[paths.length - 1] ?? null)
  }, [])

  const retain = useCallback((valid: Set<string>) => {
    setSelected((current) => new Set([...current].filter((path) => valid.has(path))))
  }, [])

  const clear = useCallback(() => {
    setSelected(new Set())
  }, [])

  const range = (items: Entry[], from: string | null, toIndex: number) => {
    const found = items.findIndex((item) => item.path === from)
    const fromIndex = found < 0 ? toIndex : found
    const low = Math.min(fromIndex, toIndex)
    const high = Math.max(fromIndex, toIndex)
    return items.slice(low, high + 1).map((item) => item.path)
  }

  const mouseDown = (items: Entry[], index: number, event: MouseEvent) => {
    const entry = items[index]
    const ctrl = event.ctrlKey || event.metaKey
    if (event.shiftKey) {
      const paths = range(items, anchor, index)
      setSelected((current) => (ctrl ? new Set([...current, ...paths]) : new Set(paths)))
      setFocus(entry.path)
      return
    }
    if (ctrl) {
      setSelected((current) => {
        const next = new Set(current)
        if (next.has(entry.path)) next.delete(entry.path)
        else next.add(entry.path)
        return next
      })
    } else if (!selected.has(entry.path)) {
      // 按下已选中的项目先不收缩,可能是要拖动整组
      setSelected(new Set([entry.path]))
    }
    setAnchor(entry.path)
    setFocus(entry.path)
  }

  // 没有拖动、直接松开:单击已选中的项目时收缩为单选
  const click = (entry: Entry, event: MouseEvent) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey) return
    setSelected(new Set([entry.path]))
  }

  const ensure = (entry: Entry) => {
    if (!selected.has(entry.path)) replace([entry.path])
  }

  const marqueeStart = (additive: boolean) => {
    marqueeBase.current = additive ? new Set(selected) : new Set()
  }

  const marqueeChange = (paths: string[]) => {
    setSelected(new Set([...marqueeBase.current, ...paths]))
  }

  // 键盘移动焦点;extend 为 true 时(按住 Shift)从锚点连选到新位置
  const moveFocus = (items: Entry[], nextIndex: number, extend: boolean): string | null => {
    if (items.length === 0) return null
    const index = Math.max(0, Math.min(items.length - 1, nextIndex))
    const entry = items[index]
    if (extend) {
      setSelected(new Set(range(items, anchor ?? focus, index)))
    } else {
      setSelected(new Set([entry.path]))
      setAnchor(entry.path)
    }
    setFocus(entry.path)
    return entry.path
  }

  const focusIndex = (items: Entry[]) => items.findIndex((item) => item.path === focus)

  const selectAll = (items: Entry[]) => setSelected(new Set(items.map((item) => item.path)))

  // 返回同一个对象、每次渲染更新字段:依赖它的 useCallback 不会因此失效,读到的又总是最新值
  const api = useRef({} as SelectionShape).current
  Object.assign(api, {
    selected,
    focus,
    replace,
    retain,
    clear,
    mouseDown,
    click,
    ensure,
    marqueeStart,
    marqueeChange,
    moveFocus,
    focusIndex,
    selectAll,
  })
  return api
}

interface SelectionShape {
  selected: Set<string>
  focus: string | null
  replace: (paths: string[]) => void
  retain: (valid: Set<string>) => void
  clear: () => void
  mouseDown: (items: Entry[], index: number, event: MouseEvent) => void
  click: (entry: Entry, event: MouseEvent) => void
  ensure: (entry: Entry) => void
  marqueeStart: (additive: boolean) => void
  marqueeChange: (paths: string[]) => void
  moveFocus: (items: Entry[], nextIndex: number, extend: boolean) => string | null
  focusIndex: (items: Entry[]) => number
  selectAll: (items: Entry[]) => void
}

export type SelectionApi = SelectionShape
