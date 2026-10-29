import { useState, type FormEvent } from 'react'
import { authApi } from '../api'
import { errorMessage } from '../api/client'
import { Icon } from './Icon'
import ui from '../styles/ui.module.css'
import styles from './Login.module.css'

interface Props {
  initialized: boolean
  onDone: (username: string) => void
}

// 首次使用时创建管理员账号,之后是普通登录
export function Login({ initialized, onDone }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!initialized && password !== confirm) {
      setError('两次输入的密码不一致')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = initialized ? await authApi.login(username, password) : await authApi.setup(username, password)
      onDone(result.username)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={submit}>
        <div className={styles.logo}>
          <Icon name="server" size={28} />
        </div>
        <h1 className={styles.title}>SSH 文件管理器</h1>
        <p className={styles.subtitle}>{initialized ? '登录以继续' : '首次使用,请创建管理员账号'}</p>
        <div className={ui.field}>
          <label className={ui.label}>用户名</label>
          <input className={ui.input} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
        </div>
        <div className={ui.field}>
          <label className={ui.label}>密码</label>
          <input
            className={ui.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={initialized ? 'current-password' : 'new-password'}
          />
        </div>
        {!initialized ? (
          <div className={ui.field}>
            <label className={ui.label}>确认密码</label>
            <input className={ui.input} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            <span className={ui.hint}>密码至少 8 位。这个账号可以访问你添加的所有服务器,请设置强密码。</span>
          </div>
        ) : null}
        {error ? <div className={styles.error}>{error}</div> : null}
        <button className={ui.primary} style={{ width: '100%', height: 36, marginTop: 6 }} disabled={busy || !username || !password}>
          {busy ? '请稍候…' : initialized ? '登录' : '创建并登录'}
        </button>
      </form>
    </div>
  )
}
