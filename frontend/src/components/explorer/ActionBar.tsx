import { useState, type MouseEvent } from 'react'
import type { Entry, HostInfo } from '../../api/types'
import { isArchive } from '../../utils/fileTypes'
import { ContextMenu, type MenuItem } from '../ContextMenu'
import { Icon, type IconName } from '../Icon'
import type { ViewMode } from './types'
import type { FileActions } from './useFileActions'
import type { TransferActions } from './useTransfer'
import styles from './ActionBar.module.css'

interface Props {
  selected: Entry[]
  info: HostInfo | null
  searching: boolean
  view: ViewMode
  showHidden: boolean
  actions: FileActions
  transfer: TransferActions
  setView: (view: ViewMode) => void
  setShowHidden: (show: boolean) => void
  pickUpload: (folder: boolean) => void
  startRename: () => void
}

// 宝塔风格的操作栏:常用操作一字排开,不用找右键菜单
export function ActionBar(props: Props) {
  const { selected, actions, transfer, searching } = props
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const none = selected.length === 0
  const single = selected.length === 1 ? selected[0] : null
  const canShell = props.info?.hasShell ?? false
  const clip = transfer.clipboard

  const dropdown = (event: MouseEvent, items: MenuItem[]) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setMenu({ x: rect.left, y: rect.bottom + 2, items })
  }

  const button = (icon: IconName, label: string, onClick: (event: MouseEvent) => void, disabled = false, primary = false) => (
    <button className={primary ? styles.primary : styles.button} onClick={onClick} disabled={disabled}>
      <Icon name={icon} size={15} />
      <span>{label}</span>
    </button>
  )

  return (
    <div className={styles.bar}>
      {button('upload', '上传', (event) =>
        dropdown(event, [
          { label: '上传文件', icon: 'filePlus', onClick: () => props.pickUpload(false) },
          { label: '上传文件夹', icon: 'folderPlus', onClick: () => props.pickUpload(true) },
        ]), searching, true)}
      {button('plus', '新建', (event) =>
        dropdown(event, [
          { label: '文件夹', icon: 'folderPlus', shortcut: 'Ctrl+Shift+N', onClick: () => void actions.create('folder') },
          { label: '文本文件', icon: 'filePlus', onClick: () => void actions.create('file') },
        ]), searching)}
      <span className={styles.divider} />
      {button('cut', '剪切', () => transfer.setClipboard('cut', selected), none)}
      {button('copy', '复制', () => transfer.setClipboard('copy', selected), none)}
      {button('paste', clip ? `粘贴 (${clip.paths.length})` : '粘贴', () => transfer.paste(), !clip || searching)}
      {button('rename', '重命名', props.startRename, !single)}
      {button('trash', '删除', () => void actions.remove(selected), none)}
      <span className={styles.divider} />
      {button('download', '下载', () => actions.download(selected), none)}
      {button('archive', '压缩', () => actions.compress(selected), none || searching || !canShell)}
      {button('extract', '解压', () => single && actions.extract(single), !single || !isArchive(single.name) || !canShell)}
      {button('lock', '权限', () => actions.permission(selected), none)}
      <span className={styles.spacer} />
      {clip ? (
        <span className={styles.clip} title={clip.paths.join('\n')}>
          {clip.mode === 'cut' ? '已剪切' : '已复制'} {clip.paths.length} 项 · {clip.hostName}
        </span>
      ) : null}
      <button
        className={`${styles.iconButton} ${props.showHidden ? styles.on : ''}`}
        title={props.showHidden ? '隐藏以 . 开头的文件' : '显示以 . 开头的文件'}
        onClick={() => props.setShowHidden(!props.showHidden)}
      >
        <Icon name={props.showHidden ? 'eye' : 'eyeOff'} size={16} />
      </button>
      <div className={styles.views}>
        <button className={props.view === 'details' ? styles.on : ''} title="详细信息" onClick={() => props.setView('details')}>
          <Icon name="list" size={16} />
        </button>
        <button className={props.view === 'grid' ? styles.on : ''} title="大图标" onClick={() => props.setView('grid')}>
          <Icon name="grid" size={16} />
        </button>
      </div>
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
    </div>
  )
}
