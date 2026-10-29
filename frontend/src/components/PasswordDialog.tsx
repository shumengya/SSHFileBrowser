import { useState } from 'react'
import { authApi } from '../api'
import { errorMessage } from '../api/client'
import { Modal } from './Modal'
import { useToast } from './Toast'
import ui from '../styles/ui.module.css'

export function PasswordDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (newPassword !== confirm) {
      setError('两次输入的新密码不一致')
      return
    }
    setBusy(true)
    setError('')
    try {
      await authApi.changePassword(oldPassword, newPassword)
      toast.success('密码已修改,其它设备上的登录已失效')
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="修改密码"
      onClose={onClose}
      width={380}
      footer={
        <>
          <button className={ui.btn} onClick={onClose}>
            取消
          </button>
          <button className={ui.primary} onClick={submit} disabled={busy || !oldPassword || !newPassword}>
            确定
          </button>
        </>
      }
    >
      <div className={ui.field}>
        <label className={ui.label}>原密码</label>
        <input className={ui.input} type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} autoFocus />
      </div>
      <div className={ui.field}>
        <label className={ui.label}>新密码(至少 8 位)</label>
        <input className={ui.input} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
      </div>
      <div className={ui.field}>
        <label className={ui.label}>确认新密码</label>
        <input
          className={ui.input}
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
        />
      </div>
      {error ? <div className={ui.error}>{error}</div> : null}
    </Modal>
  )
}
