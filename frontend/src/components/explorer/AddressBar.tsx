import { useEffect, useRef, useState, type RefObject } from 'react'
import { crumbs, resolvePath } from '../../utils/path'
import { Icon } from '../Icon'
import styles from './Toolbar.module.css'

export interface AddressHandle {
  edit: () => void
}

interface Props {
  cwd: string
  home: string
  searchLabel: string | null
  handle: RefObject<AddressHandle | null>
  onNavigate: (path: string) => void
}

// 面包屑地址栏:点某一段跳转,点空白处变成可编辑的路径输入框(支持 ~ 和相对路径)
export function AddressBar({ cwd, home, searchLabel, handle, onNavigate }: Props) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(cwd)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    handle.current = {
      edit: () => {
        setText(cwd)
        setEditing(true)
      },
    }
  }, [cwd, handle])

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  if (editing) {
    return (
      <div className={styles.address}>
        <Icon name="hardDrive" size={15} className={styles.addressIcon} />
        <input
          ref={inputRef}
          className={styles.addressInput}
          value={text}
          spellCheck={false}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              setEditing(false)
            }
            if (event.key === 'Enter') {
              setEditing(false)
              onNavigate(resolvePath(text, cwd, home))
            }
          }}
        />
      </div>
    )
  }

  return (
    <div
      className={styles.address}
      onClick={(event) => {
        if (event.target === event.currentTarget || (event.target as HTMLElement).dataset.blank !== undefined) {
          setText(cwd)
          setEditing(true)
        }
      }}
      title="点击空白处输入路径"
    >
      <Icon name="hardDrive" size={15} className={styles.addressIcon} />
      <div className={styles.crumbs} data-blank="">
        {searchLabel ? (
          <span className={styles.searchCrumb}>{searchLabel}</span>
        ) : (
          crumbs(cwd).map((crumb, index) => (
            <span key={crumb.path} className={styles.crumbWrap}>
              {index > 0 ? <Icon name="chevronRight" size={12} className={styles.crumbSep} /> : null}
              <button className={styles.crumb} onClick={() => onNavigate(crumb.path)}>
                {crumb.name}
              </button>
            </span>
          ))
        )}
      </div>
    </div>
  )
}
