import { useState } from 'react'
import { errorMessage } from '../../api/client'
import type { Host } from '../../api/types'
import { Icon } from '../Icon'
import { useToast } from '../Toast'
import type { ConnState } from './useDirectory'
import ui from '../../styles/ui.module.css'
import styles from './Explorer.module.css'

interface Props {
  host: Host
  conn: Exclude<ConnState, { kind: 'ready' }>
  onRetry: () => void
  onTrust: (fingerprint: string) => Promise<void>
  onEditHost: () => void
}

// 连接中 / 连接失败 / 主机指纹变化 三种状态的占位页
export function ConnectionView({ host, conn, onRetry, onTrust, onEditHost }: Props) {
  const toast = useToast()
  const [trusting, setTrusting] = useState(false)

  if (conn.kind === 'connecting') {
    return (
      <div className={styles.center}>
        <span className={ui.spinner} />
        <div className={styles.centerText}>
          正在连接 {host.username}@{host.address}:{host.port} …
        </div>
      </div>
    )
  }

  if (conn.fingerprint) {
    const trust = async () => {
      setTrusting(true)
      try {
        await onTrust(conn.fingerprint!)
      } catch (error) {
        toast.error(errorMessage(error))
      } finally {
        setTrusting(false)
      }
    }
    return (
      <div className={styles.center}>
        <Icon name="alert" size={40} className={styles.warnIcon} />
        <div className={styles.centerTitle}>服务器指纹发生变化</div>
        <div className={styles.centerText}>
          「{host.name}」的主机密钥和上次连接时记录的不一致。如果你刚重装过系统或更换了 SSH 密钥,这是正常的;
          否则可能有人在拦截连接,请先确认再继续。
        </div>
        <div className={styles.fingerprint}>记录的指纹:{host.hostKey || '无'}</div>
        <div className={styles.fingerprint}>当前的指纹:{conn.fingerprint}</div>
        <div className={styles.buttons}>
          <button className={ui.btn} onClick={onRetry}>
            重试
          </button>
          <button className={ui.danger} onClick={trust} disabled={trusting}>
            信任新指纹并连接
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.center}>
      <Icon name="alert" size={40} className={styles.errorIcon} />
      <div className={styles.centerTitle}>无法连接到 {host.name}</div>
      <div className={styles.centerText}>{conn.message}</div>
      <div className={styles.buttons}>
        <button className={ui.btn} onClick={onEditHost}>
          编辑连接
        </button>
        <button className={ui.primary} onClick={onRetry}>
          重试
        </button>
      </div>
    </div>
  )
}
