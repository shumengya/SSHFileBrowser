import { useEffect, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import type { Entry } from '../../api/types'
import { formatSize, formatTime, modeString } from '../../utils/format'
import { typeLabel } from '../../utils/fileTypes'
import { dirname } from '../../utils/path'
import { FileIcon } from '../FileIcon'
import type { ViewMode } from './types'
import styles from './FileView.module.css'

export interface ItemHandlers {
  onMouseDown: (event: MouseEvent) => void
  onClick: (event: MouseEvent) => void
  onDoubleClick: () => void
  onContextMenu: (event: MouseEvent) => void
  onDragStart: (event: DragEvent) => void
  onDragOver: (event: DragEvent) => void
  onDrop: (event: DragEvent) => void
  onDragEnd: () => void
}

interface Props extends ItemHandlers {
  entry: Entry
  view: ViewMode
  selected: boolean
  focused: boolean
  cut: boolean
  dropping: boolean
  renaming: boolean
  showLocation: boolean
  onRename: (name: string | null) => void
}

export function FileItem(props: Props) {
  const { entry, view, renaming } = props
  const className = [
    view === 'details' ? styles.row : styles.tile,
    props.selected ? styles.selected : '',
    props.focused ? styles.focused : '',
    props.cut ? styles.cut : '',
    props.dropping ? styles.dropping : '',
    entry.name.startsWith('.') ? styles.hidden : '',
  ].join(' ')

  const name = renaming ? (
    <RenameInput entry={entry} multiline={view === 'grid'} onDone={props.onRename} />
  ) : (
    <span className={styles.name} title={entry.target ? `${entry.name} -> ${entry.target}` : entry.name}>
      {entry.name}
    </span>
  )

  return (
    <div
      className={className}
      data-path={entry.path}
      draggable={!renaming}
      onMouseDown={props.onMouseDown}
      onClick={props.onClick}
      onDoubleClick={props.onDoubleClick}
      onContextMenu={props.onContextMenu}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      onDragEnd={props.onDragEnd}
    >
      {view === 'grid' ? (
        <>
          <FileIcon entry={entry} size={48} />
          {name}
        </>
      ) : (
        <>
          <div className={styles.nameCell}>
            <FileIcon entry={entry} size={20} />
            {name}
          </div>
          {props.showLocation ? (
            <div className={styles.cell} title={dirname(entry.path)}>
              {dirname(entry.path)}
            </div>
          ) : null}
          <div className={styles.cell}>{formatTime(entry.mtime)}</div>
          <div className={styles.cell}>{typeLabel(entry)}</div>
          <div className={`${styles.cell} ${styles.right}`}>{entry.isDir ? '' : formatSize(entry.size)}</div>
          <div className={`${styles.cell} ${styles.mono}`} title={modeString(entry.mode)}>
            {entry.mode} <span className={styles.dim}>{modeString(entry.mode)}</span>
          </div>
          <div className={styles.cell} title={`${entry.owner}:${entry.group}`}>
            {entry.owner}
            <span className={styles.dim}> / {entry.group}</span>
          </div>
        </>
      )}
    </div>
  )
}

// 原地重命名:选中主文件名(不含扩展名),回车确认,Esc 取消,失去焦点也确认
function RenameInput({ entry, multiline, onDone }: { entry: Entry; multiline: boolean; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(entry.name)
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const finished = useRef(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    element.focus()
    const dot = entry.name.lastIndexOf('.')
    element.setSelectionRange(0, !entry.isDir && dot > 0 ? dot : entry.name.length)
  }, [entry])

  const finish = (result: string | null) => {
    if (finished.current) return
    finished.current = true
    onDone(result)
  }

  const common = {
    ref,
    className: multiline ? styles.renameArea : styles.renameInput,
    value,
    spellCheck: false,
    onChange: (event: { target: { value: string } }) => setValue(event.target.value.replace(/\n/g, '')),
    onBlur: () => finish(value),
    onMouseDown: (event: MouseEvent) => event.stopPropagation(),
    onDoubleClick: (event: MouseEvent) => event.stopPropagation(),
    onKeyDown: (event: React.KeyboardEvent) => {
      event.stopPropagation()
      if (event.key === 'Enter') {
        event.preventDefault()
        finish(value)
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        finish(null)
      }
    },
  }
  return multiline ? <textarea {...common} rows={2} /> : <input {...common} />
}
