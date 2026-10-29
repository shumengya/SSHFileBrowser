import { forwardRef, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import type { Entry } from '../../api/types'
import { Icon } from '../Icon'
import { DROP_CWD, type DragDropApi } from './dnd'
import { FileItem } from './FileItem'
import type { Sort, SortKey, ViewMode } from './types'
import type { SelectionApi } from './useSelection'
import ui from '../../styles/ui.module.css'
import styles from './FileView.module.css'

interface Props {
  items: Entry[]
  view: ViewMode
  sort: Sort
  onSort: (key: SortKey) => void
  selection: SelectionApi
  cutPaths: Set<string>
  renaming: string | null
  showLocation: boolean
  loading: boolean
  emptyText: string
  dnd: DragDropApi
  onOpen: (entry: Entry) => void
  onItemMenu: (event: MouseEvent) => void
  onBlankMenu: (event: MouseEvent) => void
  onRename: (entry: Entry, name: string | null) => void
}

const columns: { key: SortKey; label: string; search?: boolean }[] = [
  { key: 'name', label: '名称' },
  { key: 'location', label: '位置', search: true },
  { key: 'mtime', label: '修改日期' },
  { key: 'type', label: '类型' },
  { key: 'size', label: '大小' },
  { key: 'mode', label: '权限' },
  { key: 'owner', label: '所有者' },
]

type Rect = { left: number; top: number; width: number; height: number }

export const FileView = forwardRef<HTMLDivElement, Props>(function FileView(props, ref) {
  const { items, view, selection, dnd } = props
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const innerRef = useRef<HTMLDivElement | null>(null)

  const setRefs = (element: HTMLDivElement | null) => {
    innerRef.current = element
    if (typeof ref === 'function') ref(element)
    else if (ref) ref.current = element
  }

  // 空白处按下:清空选择(按 Ctrl 时保留),拖动则框选
  const blankMouseDown = (event: MouseEvent) => {
    const container = innerRef.current
    if (event.button !== 0 || !container) return
    if ((event.target as HTMLElement).closest('[data-path], [data-header]')) return
    event.preventDefault()
    container.focus()
    const additive = event.ctrlKey || event.metaKey
    if (!additive) selection.clear()
    selection.marqueeStart(additive)
    const origin = container.getBoundingClientRect()
    const startX = event.clientX - origin.left + container.scrollLeft
    const startY = event.clientY - origin.top + container.scrollTop
    let lastY = event.clientY
    let moved = false
    let scrollTimer = 0

    const update = (clientX: number, clientY: number) => {
      const box = container.getBoundingClientRect()
      const x = clientX - box.left + container.scrollLeft
      const y = clientY - box.top + container.scrollTop
      const rect = { left: Math.min(startX, x), top: Math.min(startY, y), width: Math.abs(x - startX), height: Math.abs(y - startY) }
      if (!moved && rect.width < 4 && rect.height < 4) return
      moved = true
      setMarquee(rect)
      const hits: string[] = []
      for (const element of container.querySelectorAll<HTMLElement>('[data-path]')) {
        const itemBox = element.getBoundingClientRect()
        const itemLeft = itemBox.left - box.left + container.scrollLeft
        const itemTop = itemBox.top - box.top + container.scrollTop
        const overlaps =
          itemLeft < rect.left + rect.width && itemLeft + itemBox.width > rect.left &&
          itemTop < rect.top + rect.height && itemTop + itemBox.height > rect.top
        if (overlaps) hits.push(element.dataset.path!)
      }
      selection.marqueeChange(hits)
    }

    let lastX = event.clientX
    const onMove = (move: globalThis.MouseEvent) => {
      lastX = move.clientX
      lastY = move.clientY
      update(move.clientX, move.clientY)
    }
    // 拖到边缘时自动滚动
    scrollTimer = window.setInterval(() => {
      const box = container.getBoundingClientRect()
      const delta = lastY < box.top + 30 ? -20 : lastY > box.bottom - 30 ? 20 : 0
      if (delta && moved) {
        container.scrollTop += delta
        update(lastX, lastY)
      }
    }, 40)
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.clearInterval(scrollTimer)
      setMarquee(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const visibleColumns = columns.filter((column) => !column.search || props.showLocation)
  const template = props.showLocation
    ? 'minmax(220px, 3fr) minmax(160px, 2fr) 136px 110px 86px 128px 120px'
    : 'minmax(240px, 4fr) 136px 120px 90px 128px minmax(110px, 1fr)'

  return (
    <div
      ref={setRefs}
      className={`${styles.container} ${dnd.dropTarget === DROP_CWD ? styles.containerDrop : ''}`}
      style={{ '--columns': template } as CSSProperties}
      tabIndex={-1}
      onMouseDown={blankMouseDown}
      onContextMenu={(event) => {
        if ((event.target as HTMLElement).closest('[data-path]')) return
        event.preventDefault()
        selection.clear()
        props.onBlankMenu(event)
      }}
      onDragOver={dnd.containerDragOver}
      onDragLeave={dnd.containerDragLeave}
      onDrop={dnd.containerDrop}
    >
      {props.loading ? <div className={styles.loadingBar} /> : null}
      {view === 'details' ? (
        <div className={styles.header} data-header="">
          {visibleColumns.map((column) => (
            <button key={column.key} className={styles.headerCell} onClick={() => props.onSort(column.key)}>
              <span>{column.label}</span>
              {props.sort.key === column.key ? (
                <Icon name="chevronDown" size={12} style={{ transform: props.sort.asc ? 'rotate(180deg)' : undefined }} />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
      <div className={view === 'grid' ? styles.grid : styles.rows}>
        {items.map((entry, index) => (
          <FileItem
            key={entry.path}
            entry={entry}
            view={view}
            selected={selection.selected.has(entry.path)}
            focused={selection.focus === entry.path}
            cut={props.cutPaths.has(entry.path)}
            dropping={dnd.dropTarget === entry.path}
            renaming={props.renaming === entry.path}
            showLocation={props.showLocation}
            onRename={(name) => props.onRename(entry, name)}
            onMouseDown={(event) => {
              event.stopPropagation()
              // 右键已选中的项目不改变选择,右键未选中的项目则单选它
              if (event.button === 2 && selection.selected.has(entry.path)) return
              if (event.button === 0 || event.button === 2) selection.mouseDown(items, index, event)
            }}
            onClick={(event) => selection.click(entry, event)}
            onDoubleClick={() => props.onOpen(entry)}
            onContextMenu={(event) => {
              event.preventDefault()
              props.onItemMenu(event)
            }}
            onDragStart={(event) => dnd.itemDragStart(entry, event)}
            onDragOver={(event) => dnd.itemDragOver(entry, event)}
            onDrop={(event) => dnd.itemDrop(entry, event)}
            onDragEnd={dnd.dragEnd}
          />
        ))}
      </div>
      {items.length === 0 ? (
        <div className={styles.empty}>{props.loading ? <span className={ui.spinner} /> : props.emptyText}</div>
      ) : null}
      {dnd.dropTarget === DROP_CWD ? <div className={styles.dropHint}>放到当前文件夹</div> : null}
      {marquee ? <div className={styles.marquee} style={marquee} /> : null}
    </div>
  )
})
