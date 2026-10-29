import { useState } from 'react'
import { fsApi } from '../../api'
import { errorMessage } from '../../api/client'
import type { Entry, Host } from '../../api/types'
import { modeString } from '../../utils/format'
import { Modal } from '../Modal'
import { useToast } from '../Toast'
import ui from '../../styles/ui.module.css'
import styles from './dialogs.module.css'

interface Props {
  host: Host
  entries: Entry[]
  hasShell: boolean
  onClose: () => void
  onDone: () => void
}

const groups = [
  { label: '所有者', shift: 6 },
  { label: '用户组', shift: 3 },
  { label: '公共', shift: 0 },
]
const bits = [
  { label: '读取', value: 4 },
  { label: '写入', value: 2 },
  { label: '执行', value: 1 },
]

// 宝塔风格的权限面板:勾选框和数字双向同步,可同时改所有者
export function PermissionDialog({ host, entries, hasShell, onClose, onDone }: Props) {
  const toast = useToast()
  const first = entries[0]
  const [mode, setMode] = useState(() => parseInt(first.mode, 8) & 0o7777)
  const [modeText, setModeText] = useState(first.mode.slice(-3))
  const [owner, setOwner] = useState(first.owner)
  const [group, setGroup] = useState(first.group)
  const [recursive, setRecursive] = useState(false)
  const [busy, setBusy] = useState(false)
  const hasDir = entries.some((entry) => entry.isDir)

  const updateMode = (next: number) => {
    setMode(next)
    setModeText((next & 0o777).toString(8).padStart(3, '0'))
  }

  const toggle = (bit: number) => updateMode(mode ^ bit)

  const submit = async () => {
    const paths = entries.map((entry) => entry.path)
    setBusy(true)
    try {
      await fsApi.chmod(host.id, paths, mode.toString(8).padStart(4, '0'), recursive)
      const ownerChanged = owner.trim() !== first.owner || group.trim() !== first.group
      if (hasShell && ownerChanged) await fsApi.chown(host.id, paths, owner.trim(), group.trim(), recursive)
      toast.success('权限已修改')
      onDone()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={entries.length === 1 ? `设置权限 - ${first.name}` : `设置权限 - ${entries.length} 个项目`}
      onClose={onClose}
      width={420}
      footer={
        <>
          <button className={ui.btn} onClick={onClose}>
            取消
          </button>
          <button className={ui.primary} onClick={submit} disabled={busy}>
            {busy ? '正在应用…' : '确定'}
          </button>
        </>
      }
    >
      <div className={styles.permGrid}>
        {groups.map((item) => (
          <fieldset key={item.label} className={styles.permGroup}>
            <legend>{item.label}</legend>
            {bits.map((bit) => {
              const value = bit.value << item.shift
              return (
                <label key={bit.label} className={ui.check}>
                  <input type="checkbox" checked={(mode & value) !== 0} onChange={() => toggle(value)} />
                  {bit.label}
                </label>
              )
            })}
          </fieldset>
        ))}
      </div>
      <div className={ui.row}>
        <div className={ui.field}>
          <label className={ui.label}>权限</label>
          <input
            className={ui.input}
            value={modeText}
            maxLength={4}
            onChange={(event) => {
              const text = event.target.value.replace(/[^0-7]/g, '')
              setModeText(text)
              // 输入 3 位时保留原来的 setuid/setgid/sticky 位
              if (text.length === 3) setMode((mode & 0o7000) | parseInt(text, 8))
              if (text.length === 4) setMode(parseInt(text, 8))
            }}
          />
        </div>
        <div className={ui.field} style={{ flex: 1.4 }}>
          <label className={ui.label}>&nbsp;</label>
          <div className={styles.modePreview}>{modeString(mode.toString(8))}</div>
        </div>
      </div>
      <div className={ui.row}>
        <div className={ui.field}>
          <label className={ui.label}>所有者</label>
          <input className={ui.input} value={owner} onChange={(event) => setOwner(event.target.value)} disabled={!hasShell} />
        </div>
        <div className={ui.field}>
          <label className={ui.label}>用户组</label>
          <input className={ui.input} value={group} onChange={(event) => setGroup(event.target.value)} disabled={!hasShell} />
        </div>
      </div>
      {hasDir ? (
        <label className={ui.check}>
          <input type="checkbox" checked={recursive} onChange={(event) => setRecursive(event.target.checked)} disabled={!hasShell} />
          应用到子目录和文件
        </label>
      ) : null}
      {!hasShell ? <div className={ui.hint} style={{ marginTop: 8 }}>该服务器不能执行命令,只能修改单个文件的权限位。</div> : null}
    </Modal>
  )
}
