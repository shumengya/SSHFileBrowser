import type { Entry, Host, HostInfo } from '../../api/types'
import { formatSize } from '../../utils/format'
import styles from './StatusBar.module.css'

interface Props {
  host: Host
  info: HostInfo | null
  items: Entry[]
  selected: Entry[]
  hiddenCount: number
  truncated: boolean
}

export function StatusBar({ host, info, items, selected, hiddenCount, truncated }: Props) {
  const files = selected.filter((entry) => !entry.isDir)
  const size = files.reduce((total, entry) => total + entry.size, 0)
  return (
    <div className={styles.bar}>
      <span>{items.length} 个项目</span>
      {hiddenCount > 0 ? <span className={styles.dim}>({hiddenCount} 个隐藏)</span> : null}
      {selected.length > 0 ? (
        <span>
          选中 {selected.length} 个项目{files.length > 0 ? `,${formatSize(size)}` : ''}
        </span>
      ) : null}
      {truncated ? <span className={styles.warn}>结果过多,只显示前 500 条</span> : null}
      <span className={styles.spacer} />
      {info && !info.hasShell ? <span className={styles.warn}>无 shell:压缩、解压、改属主不可用</span> : null}
      {info?.tools.rsync ? <span className={styles.tag}>rsync</span> : null}
      <span className={styles.dim}>
        {host.username}@{host.address}:{host.port}
      </span>
    </div>
  )
}
