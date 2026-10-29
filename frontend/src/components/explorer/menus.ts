import type { Entry, HostInfo } from '../../api/types'
import { isArchive, openActionOf } from '../../utils/fileTypes'
import { tidyMenu, type MenuItem } from '../ContextMenu'
import type { ViewMode } from './types'
import type { FileActions } from './useFileActions'
import type { TransferActions } from './useTransfer'

export interface MenuDeps {
  cwd: string
  info: HostInfo | null
  searching: boolean
  view: ViewMode
  showHidden: boolean
  actions: FileActions
  transfer: TransferActions
  setView: (view: ViewMode) => void
  setShowHidden: (show: boolean) => void
  selectAll: () => void
  refresh: () => void
  pickUpload: (folder: boolean) => void
  startRename: (entry: Entry) => void
}

const openLabel = { enter: '打开', edit: '编辑', preview: '预览', extract: '解压', download: '下载' }

// 右键文件/文件夹
export function itemMenu(selected: Entry[], deps: MenuDeps): MenuItem[] {
  const { actions, transfer, info } = deps
  const single = selected.length === 1 ? selected[0] : null
  const canShell = info?.hasShell ?? false
  const zipDownload = selected.length > 1 || (single?.isDir ?? false)
  const pasteInto = single?.isDir && transfer.clipboard
  return tidyMenu([
    single && { label: openLabel[openActionOf(single)], icon: single.isDir ? 'folderPlus' : 'edit', onClick: () => actions.open(single) },
    single && !single.isDir && openActionOf(single) !== 'edit' && { label: '用编辑器打开', icon: 'edit', onClick: () => actions.edit(single) },
    deps.searching && single && { label: '打开所在位置', icon: 'folderPlus', onClick: () => actions.reveal(single) },
    { label: zipDownload ? '打包下载 (zip)' : '下载', icon: 'download', onClick: () => actions.download(selected) },
    'separator',
    { label: '剪切', icon: 'cut', shortcut: 'Ctrl+X', onClick: () => transfer.setClipboard('cut', selected) },
    { label: '复制', icon: 'copy', shortcut: 'Ctrl+C', onClick: () => transfer.setClipboard('copy', selected) },
    pasteInto && { label: '粘贴到此文件夹', icon: 'paste', onClick: () => transfer.paste(single.path) },
    'separator',
    single && { label: '重命名', icon: 'rename', shortcut: 'F2', onClick: () => deps.startRename(single) },
    { label: '删除', icon: 'trash', shortcut: 'Delete', danger: true, onClick: () => void actions.remove(selected) },
    'separator',
    !deps.searching && { label: '压缩…', icon: 'archive', disabled: !canShell, onClick: () => actions.compress(selected) },
    single && isArchive(single.name) && { label: '解压…', icon: 'extract', disabled: !canShell, onClick: () => actions.extract(single) },
    { label: '权限…', icon: 'lock', onClick: () => actions.permission(selected) },
    'separator',
    { label: '复制路径', icon: 'link', onClick: () => actions.copyPath(selected.map((entry) => entry.path)) },
    single?.isDir && { label: '固定到快速访问', icon: 'star', onClick: () => actions.bookmark(single.path) },
    single && { label: '属性', icon: 'info', onClick: () => void actions.properties(single) },
  ])
}

// 右键空白处
export function blankMenu(deps: MenuDeps): MenuItem[] {
  const { actions, transfer } = deps
  const clip = transfer.clipboard
  return tidyMenu([
    { label: deps.view === 'details' ? '大图标' : '详细信息', icon: deps.view === 'details' ? 'grid' : 'list', onClick: () => deps.setView(deps.view === 'details' ? 'grid' : 'details') },
    { label: '刷新', icon: 'refresh', shortcut: 'F5', onClick: deps.refresh },
    'separator',
    !deps.searching && { label: clip ? `粘贴 (${clip.paths.length} 项)` : '粘贴', icon: 'paste', shortcut: 'Ctrl+V', disabled: !clip, onClick: () => transfer.paste() },
    'separator',
    !deps.searching && { label: '新建文件夹', icon: 'folderPlus', shortcut: 'Ctrl+Shift+N', onClick: () => void actions.create('folder') },
    !deps.searching && { label: '新建文件', icon: 'filePlus', onClick: () => void actions.create('file') },
    !deps.searching && { label: '上传文件', icon: 'upload', onClick: () => deps.pickUpload(false) },
    !deps.searching && { label: '上传文件夹', icon: 'upload', onClick: () => deps.pickUpload(true) },
    'separator',
    { label: '全选', shortcut: 'Ctrl+A', onClick: deps.selectAll },
    { label: deps.showHidden ? '不显示隐藏文件' : '显示隐藏文件', icon: deps.showHidden ? 'eyeOff' : 'eye', onClick: () => deps.setShowHidden(!deps.showHidden) },
    'separator',
    { label: '复制当前路径', icon: 'link', onClick: () => actions.copyPath([deps.cwd]) },
    { label: '固定到快速访问', icon: 'star', onClick: () => actions.bookmark(deps.cwd) },
    !deps.searching && { label: '属性', icon: 'info', onClick: () => void actions.properties() },
  ])
}
