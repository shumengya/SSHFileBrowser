import { useState, type DragEvent } from 'react'
import type { Entry } from '../../api/types'
import { dirname } from '../../utils/path'
import type { SelectionApi } from './useSelection'

const MIME = 'application/x-sfb-paths'
export const DROP_CWD = '\u0000cwd'

// dragover 阶段浏览器不让读 dataTransfer 的内容,只能看类型,所以拖动中的条目记在这里
let dragging: { hostId: number; paths: string[] } | null = null

export function readDrag(transfer: DataTransfer) {
  return transfer.types.includes(MIME) ? dragging : null
}

interface Options {
  hostId: number
  cwd: string
  searching: boolean
  selection: SelectionApi
  onDrop: (event: DragEvent, targetDir: string) => void
}

export function useDragDrop(options: Options) {
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const accepts = (event: DragEvent) => event.dataTransfer.types.includes(MIME) || event.dataTransfer.types.includes('Files')
  const effect = (event: DragEvent) => (event.dataTransfer.types.includes(MIME) && !event.ctrlKey ? 'move' : 'copy')
  const canDropInto = (entry: Entry) => entry.isDir && !entry.broken && !dragging?.paths.includes(entry.path)

  const itemDragStart = (entry: Entry, event: DragEvent) => {
    const { selection } = options
    const paths = selection.selected.has(entry.path) ? [...selection.selected] : [entry.path]
    if (!selection.selected.has(entry.path)) selection.replace([entry.path])
    dragging = { hostId: options.hostId, paths }
    event.dataTransfer.setData(MIME, paths.join('\n'))
    event.dataTransfer.effectAllowed = 'copyMove'
  }

  const dragEnd = () => {
    dragging = null
    setDropTarget(null)
  }

  // 拖到文件夹上 = 放进这个文件夹;拖到文件上则冒泡给容器,当作放到当前目录
  const itemDragOver = (entry: Entry, event: DragEvent) => {
    if (!accepts(event) || !canDropInto(entry)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = effect(event)
    setDropTarget(entry.path)
  }

  const itemDrop = (entry: Entry, event: DragEvent) => {
    if (!accepts(event) || !canDropInto(entry)) return
    event.preventDefault()
    event.stopPropagation()
    setDropTarget(null)
    options.onDrop(event, entry.path)
  }

  const containerDragOver = (event: DragEvent) => {
    if (!accepts(event) || options.searching) return
    // 从当前目录拖出来又放回空白处,什么都不用做
    if (readDrag(event.dataTransfer)?.paths.every((path) => dirname(path) === options.cwd)) {
      setDropTarget(null)
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = effect(event)
    setDropTarget(DROP_CWD)
  }

  const containerDragLeave = (event: DragEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null)
  }

  const containerDrop = (event: DragEvent) => {
    if (!accepts(event) || options.searching) return
    event.preventDefault()
    setDropTarget(null)
    options.onDrop(event, options.cwd)
  }

  return { dropTarget, itemDragStart, itemDragOver, itemDrop, dragEnd, containerDragOver, containerDragLeave, containerDrop }
}

export type DragDropApi = ReturnType<typeof useDragDrop>
