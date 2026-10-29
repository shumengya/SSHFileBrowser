import { useState } from 'react'
import { fsApi } from '../../api'
import { errorMessage } from '../../api/client'
import type { ArchiveFormat, Entry, Host, HostInfo, ServerTask } from '../../api/types'
import { basename } from '../../utils/path'
import { Modal } from '../Modal'
import { useToast } from '../Toast'
import ui from '../../styles/ui.module.css'

interface Props {
  host: Host
  info: HostInfo | null
  cwd: string
  entries: Entry[]
  onClose: () => void
  onStarted: (task: ServerTask) => void
}

const formats: { value: ArchiveFormat; label: string; tool: string }[] = [
  { value: 'zip', label: 'zip(Windows 可直接打开)', tool: 'zip' },
  { value: 'tar.gz', label: 'tar.gz(Linux 常用)', tool: 'tar' },
  { value: 'tar.bz2', label: 'tar.bz2', tool: 'tar' },
  { value: 'tar.xz', label: 'tar.xz(压缩率高)', tool: 'tar' },
  { value: 'tar', label: 'tar(只打包不压缩)', tool: 'tar' },
]

const stripExtension = (name: string) => name.replace(/\.(zip|tar|tar\.gz|tar\.bz2|tar\.xz)$/i, '')

export function CompressDialog({ host, info, cwd, entries, onClose, onStarted }: Props) {
  const toast = useToast()
  const available = formats.filter((format) => info?.tools[format.tool])
  const [format, setFormat] = useState<ArchiveFormat>(available[0]?.value ?? 'zip')
  const base = entries.length === 1 ? entries[0].name.replace(/\.[^./]+$/, '') || entries[0].name : basename(cwd) || 'archive'
  const [name, setName] = useState(`${base}.${format}`)
  const [busy, setBusy] = useState(false)

  const changeFormat = (next: ArchiveFormat) => {
    setFormat(next)
    setName(`${stripExtension(name)}.${next}`)
  }

  const submit = async () => {
    setBusy(true)
    try {
      onStarted(await fsApi.compress(host.id, cwd, entries.map((entry) => entry.path), name.trim(), format))
    } catch (error) {
      toast.error(errorMessage(error))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={entries.length === 1 ? `压缩 ${entries[0].name}` : `压缩 ${entries.length} 个项目`}
      onClose={onClose}
      width={420}
      footer={
        <>
          <button className={ui.btn} onClick={onClose}>
            取消
          </button>
          <button className={ui.primary} onClick={submit} disabled={busy || !name.trim() || available.length === 0}>
            压缩
          </button>
        </>
      }
    >
      <div className={ui.field}>
        <label className={ui.label}>格式</label>
        <select className={ui.input} value={format} onChange={(event) => changeFormat(event.target.value as ArchiveFormat)}>
          {formats.map((item) => (
            <option key={item.value} value={item.value} disabled={!info?.tools[item.tool]}>
              {item.label}
              {info?.tools[item.tool] ? '' : '(服务器未安装)'}
            </option>
          ))}
        </select>
      </div>
      <div className={ui.field}>
        <label className={ui.label}>压缩包名称(保存在当前目录)</label>
        <input className={ui.input} value={name} onChange={(event) => setName(event.target.value)} autoFocus onKeyDown={(event) => { if (event.key === 'Enter') void submit() }} />
      </div>
      {available.length === 0 ? <div className={ui.error}>服务器上没有 zip 或 tar 命令</div> : null}
    </Modal>
  )
}
