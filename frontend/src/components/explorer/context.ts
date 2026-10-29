import type { Entry, Host } from '../../api/types'
import type { ModalState } from './types'
import type { DirectoryApi } from './useDirectory'
import type { SelectionApi } from './useSelection'

// 各个操作 hook 共用的上下文,由 Explorer 每次渲染时组装
export interface ExplorerContext {
  host: Host
  // 标签页实例标识:自己发出的刷新事件自己不再处理
  origin: string
  dir: DirectoryApi
  selection: SelectionApi
  selectedEntries: Entry[]
  setRenaming: (path: string | null) => void
  setModal: (modal: ModalState | null) => void
  onAddBookmark: (path: string) => void
}
