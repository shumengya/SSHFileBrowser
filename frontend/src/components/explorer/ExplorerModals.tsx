import type { Entry, Host, HostInfo } from '../../api/types'
import { useTasks } from '../../state/tasks'
import { dirname } from '../../utils/path'
import { EditorModal } from '../dialogs/EditorModal'
import { PreviewModal } from '../dialogs/PreviewModal'
import { PermissionDialog } from '../dialogs/PermissionDialog'
import { PropertiesDialog } from '../dialogs/PropertiesDialog'
import { CompressDialog } from '../dialogs/CompressDialog'
import { ExtractDialog } from '../dialogs/ExtractDialog'
import type { ModalState } from './types'
import type { FileActions } from './useFileActions'

interface Props {
  host: Host
  info: HostInfo | null
  cwd: string
  items: Entry[]
  modal: ModalState | null
  setModal: (modal: ModalState | null) => void
  actions: FileActions
}

export function ExplorerModals({ host, info, cwd, items, modal, setModal, actions }: Props) {
  const tasks = useTasks()
  if (!modal) return null
  const close = () => setModal(null)
  const hasShell = info?.hasShell ?? false

  if (modal.kind === 'editor') {
    return <EditorModal host={host} entry={modal.entry} onClose={close} onSaved={() => actions.changed([dirname(modal.entry.path)])} />
  }
  if (modal.kind === 'preview') {
    return <PreviewModal host={host} entry={modal.entry} siblings={items} onClose={close} />
  }
  if (modal.kind === 'permission') {
    return (
      <PermissionDialog
        host={host}
        entries={modal.entries}
        hasShell={hasShell}
        onClose={close}
        onDone={() => {
          close()
          actions.changed(modal.entries.map((entry) => dirname(entry.path)))
        }}
      />
    )
  }
  if (modal.kind === 'properties') {
    return <PropertiesDialog host={host} entry={modal.entry} hasDu={hasShell} onClose={close} />
  }
  if (modal.kind === 'compress') {
    return (
      <CompressDialog
        host={host}
        info={info}
        cwd={cwd}
        entries={modal.entries}
        onClose={close}
        onStarted={(task) => {
          close()
          tasks.trackServerTask(task)
        }}
      />
    )
  }
  return (
    <ExtractDialog
      host={host}
      entry={modal.entry}
      onClose={close}
      onStarted={(task) => {
        close()
        tasks.trackServerTask(task)
      }}
    />
  )
}
