import type { Host } from '../api/types'
import { Icon } from './Icon'
import ui from '../styles/ui.module.css'
import styles from './Welcome.module.css'

interface Props {
  hosts: Host[]
  onOpen: (hostId: number) => void
  onAdd: () => void
}

// 新标签页:选一台服务器打开
export function Welcome({ hosts, onOpen, onAdd }: Props) {
  return (
    <div className={styles.page}>
      <h2 className={styles.title}>选择一台服务器</h2>
      <p className={styles.subtitle}>通过 SSH / SFTP 管理远程文件,支持 rsync 加速复制</p>
      <div className={styles.grid}>
        {hosts.map((host) => (
          <button key={host.id} className={styles.card} onClick={() => onOpen(host.id)}>
            <span className={styles.cardIcon}>
              <Icon name="server" size={22} />
            </span>
            <span className={styles.cardText}>
              <strong>{host.name}</strong>
              <span>
                {host.username}@{host.address}:{host.port}
              </span>
            </span>
          </button>
        ))}
        <button className={`${styles.card} ${styles.addCard}`} onClick={onAdd}>
          <span className={styles.cardIcon}>
            <Icon name="plus" size={22} />
          </span>
          <span className={styles.cardText}>
            <strong>添加服务器</strong>
            <span>密码或私钥登录</span>
          </span>
        </button>
      </div>
      {hosts.length === 0 ? (
        <button className={ui.primary} style={{ marginTop: 24 }} onClick={onAdd}>
          添加第一台服务器
        </button>
      ) : null}
    </div>
  )
}
