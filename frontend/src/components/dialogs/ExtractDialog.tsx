import { useState } from 'react'
import { fsApi } from '../../api'
import { errorMessage } from '../../api/client'
import type { Entry, Host, ServerTask } from '../../api/types'
import { dirname, joinPath } from '../../utils/path'
import { Modal } from '../Modal'
import { useToast } from '../Toast'
import ui from '../../styles/ui.module.css'

interface Props {
  host: Host
  entry: Entry
  onClose: () => void
  onStarted: (task: ServerTask) => void
}

const stemOf = (name: string) => name.replace(/\.(zip|tar|tgz|tbz2|txz|tar\.gz|tar\.bz2|tar\.xz)$/i, '')

export function ExtractDialog({ host, entry, onClose, onStarted }: Props) {
  const toast = useToast()
  const parent = dirname(entry.path)
  const [mode, setMode] = useState<'folder' | 'here' | 'custom'>('folder')
  const [custom, setCustom] = useState(joinPath(parent, stemOf(entry.name)))
  const [overwrite, setOverwrite] = useState(false)
  const [busy, setBusy] = useState(false)

  const dest = mode === 'here' ? parent : mode === 'folder' ? joinPath(parent, stemOf(entry.name)) : custom.trim()

  const submit = async () => {
    if (!dest.startsWith('/')) {
      toast.error('解压目录必须是绝对路径')
      return
    }
    setBusy(true)
    try {
      onStarted(await fsApi.extract(host.id, entry.path, dest, overwrite))
    } catch (error) {
      toast.error(errorMessage(error))
      setBusy(false)
    }
  }

  const option = (value: typeof mode, label: string) => (
    <label className={ui.check} style={{ marginBottom: 8 }}>
      <input type="radio" name="extract-mode" checked={mode === value} onChange={() => setMode(value)} />
      {label}
    </label>
  )

  return (
    <Modal
      title={`解压 ${entry.name}`}
      onClose={onClose}
      width={460}
      footer={
        <>
          <button className={ui.btn} onClick={onClose}>
            取消
          </button>
          <button className={ui.primary} onClick={submit} disabled={busy || !dest}>
            解压
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 6 }}>
        {option('folder', `解压到「${stemOf(entry.name)}」文件夹`)}
        {option('here', '解压到当前目录')}
        {option('custom', '解压到指定目录')}
      </div>
      {mode === 'custom' ? (
        <div className={ui.field}>
          <input className={ui.input} value={custom} onChange={(event) => setCustom(event.target.value)} autoFocus />
        </div>
      ) : null}
      <label className={ui.check}>
        <input type="checkbox" checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} />
        覆盖已存在的文件
      </label>
    </Modal>
  )
}
