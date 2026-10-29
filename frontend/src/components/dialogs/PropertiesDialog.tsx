import { useState } from 'react'
import { fsApi } from '../../api'
import { errorMessage } from '../../api/client'
import type { Entry, Host } from '../../api/types'
import { formatSize, formatTime, modeString } from '../../utils/format'
import { typeLabel } from '../../utils/fileTypes'
import { dirname } from '../../utils/path'
import { FileIcon } from '../FileIcon'
import { Modal } from '../Modal'
import ui from '../../styles/ui.module.css'
import styles from './dialogs.module.css'

interface Props {
  host: Host
  entry: Entry
  hasDu: boolean
  onClose: () => void
}

export function PropertiesDialog({ host, entry, hasDu, onClose }: Props) {
  const [size, setSize] = useState<{ state: 'idle' | 'loading' | 'done' | 'error'; value: string }>({ state: 'idle', value: '' })

  const calculate = () => {
    setSize({ state: 'loading', value: '' })
    fsApi
      .size(host.id, entry.path)
      .then((bytes) => setSize({ state: 'done', value: `${formatSize(bytes)}(${bytes.toLocaleString()} 字节)` }))
      .catch((error: unknown) => setSize({ state: 'error', value: errorMessage(error) }))
  }

  const rows: [string, React.ReactNode][] = [
    ['类型', typeLabel(entry)],
    ['位置', dirname(entry.path)],
    [
      '大小',
      entry.isDir ? (
        size.state === 'idle' ? (
          <button className={ui.btn} style={{ height: 24 }} onClick={calculate}>
            {hasDu ? '计算大小' : '计算大小(较慢)'}
          </button>
        ) : size.state === 'loading' ? (
          <span className={ui.spinner} />
        ) : (
          <span className={size.state === 'error' ? ui.error : undefined}>{size.value}</span>
        )
      ) : (
        `${formatSize(entry.size)}(${entry.size.toLocaleString()} 字节)`
      ),
    ],
    ['修改时间', formatTime(entry.mtime)],
    ['权限', `${entry.mode}  ${modeString(entry.mode)}`],
    ['所有者', `${entry.owner} / ${entry.group}`],
  ]
  if (entry.target) rows.push(['链接到', `${entry.target}${entry.broken ? '(目标不存在)' : ''}`])

  return (
    <Modal
      title={`${entry.name} 属性`}
      onClose={onClose}
      width={460}
      footer={
        <button className={ui.primary} onClick={onClose}>
          确定
        </button>
      }
    >
      <div className={styles.propHead}>
        <FileIcon entry={entry} size={40} />
        <span className={styles.propName}>{entry.name}</span>
      </div>
      <table className={styles.propTable}>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th>{label}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  )
}
