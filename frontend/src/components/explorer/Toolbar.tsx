import { useEffect, useState, type RefObject } from 'react'
import { Icon } from '../Icon'
import { AddressBar, type AddressHandle } from './AddressBar'
import type { DirectoryApi } from './useDirectory'
import styles from './Toolbar.module.css'

interface Props {
  dir: DirectoryApi
  home: string
  addressHandle: RefObject<AddressHandle | null>
  searchInput: RefObject<HTMLInputElement | null>
  onBookmark: () => void
}

export function Toolbar({ dir, home, addressHandle, searchInput, onBookmark }: Props) {
  const [keyword, setKeyword] = useState('')
  const search = dir.search

  // 退出搜索(切换目录、按 Esc)后清空搜索框
  useEffect(() => {
    if (!search) setKeyword('')
  }, [search])

  const nav = (icon: 'back' | 'forward' | 'up' | 'refresh', title: string, onClick: () => void, disabled = false) => (
    <button className={styles.navButton} title={title} onClick={onClick} disabled={disabled}>
      <Icon name={icon} size={16} />
    </button>
  )

  return (
    <div className={styles.toolbar}>
      {nav('back', '后退 (Alt+←)', dir.back, !dir.canBack)}
      {nav('forward', '前进 (Alt+→)', dir.forward, !dir.canForward)}
      {nav('up', '上一级 (Alt+↑)', dir.up, dir.cwd === '/')}
      {nav('refresh', '刷新 (F5)', () => dir.refresh(), false)}
      <AddressBar
        cwd={dir.cwd}
        home={home}
        handle={addressHandle}
        searchLabel={search ? `在 ${search.root} 中搜索「${search.keyword}」` : null}
        onNavigate={(path) => void dir.openDir(path)}
      />
      <button className={styles.navButton} title="固定到快速访问" onClick={onBookmark}>
        <Icon name="star" size={16} />
      </button>
      <div className={styles.search}>
        <Icon name="search" size={14} className={styles.searchIcon} />
        <input
          ref={searchInput}
          className={styles.searchInput}
          value={keyword}
          placeholder={`在 ${dir.cwd.split('/').pop() || '/'} 中搜索`}
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && keyword.trim()) void dir.runSearch(keyword.trim())
            if (event.key === 'Escape') {
              event.stopPropagation()
              setKeyword('')
              if (search) dir.clearSearch()
              event.currentTarget.blur()
            }
          }}
        />
        {search?.loading ? <span className={styles.searchSpinner} /> : null}
        {keyword || search ? (
          <button
            className={styles.searchClear}
            title="清除搜索"
            onClick={() => {
              setKeyword('')
              if (search) dir.clearSearch()
            }}
          >
            <Icon name="close" size={12} />
          </button>
        ) : null}
      </div>
    </div>
  )
}
