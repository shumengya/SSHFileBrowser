import { useRef, useState } from 'react'
import { hostApi } from '../api'
import { errorMessage } from '../api/client'
import type { AuthType, Host, HostForm, HostInfo } from '../api/types'
import { Modal } from './Modal'
import { useToast } from './Toast'
import ui from '../styles/ui.module.css'

interface Props {
  host: Host | null
  onClose: () => void
  onSaved: (host: Host) => void
}

type TestState = { kind: 'idle' } | { kind: 'running' } | { kind: 'ok'; info: HostInfo } | { kind: 'error'; message: string }

const toolNames = ['rsync', 'tar', 'zip', 'unzip']

export function HostDialog({ host, onClose, onSaved }: Props) {
  const toast = useToast()
  const editing = host !== null
  const [form, setForm] = useState<HostForm>({
    id: host?.id,
    name: host?.name ?? '',
    address: host?.address ?? '',
    port: host?.port ?? 22,
    username: host?.username ?? 'root',
    authType: host?.authType ?? 'password',
    secret: '',
    passphrase: '',
    defaultDir: host?.defaultDir ?? '',
    sortOrder: host?.sortOrder ?? 0,
  })
  const [test, setTest] = useState<TestState>({ kind: 'idle' })
  const [saving, setSaving] = useState(false)
  const keyInput = useRef<HTMLInputElement>(null)

  const set = <K extends keyof HostForm>(key: K, value: HostForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setTest({ kind: 'idle' })
  }

  const authChanged = editing && form.authType !== host.authType
  const secretRequired = !editing || authChanged
  const canSubmit = form.address.trim() !== '' && form.username.trim() !== '' && (!secretRequired || form.secret !== '')

  const runTest = async () => {
    setTest({ kind: 'running' })
    try {
      const info = await hostApi.test(form)
      setTest({ kind: 'ok', info })
    } catch (error) {
      setTest({ kind: 'error', message: errorMessage(error) })
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      const saved = editing ? await hostApi.update(form) : await hostApi.create(form)
      toast.success(editing ? '已保存' : '已添加')
      onSaved(saved)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const loadKeyFile = (file: File | undefined) => {
    if (!file) return
    if (file.size > 64 * 1024) {
      toast.error('私钥文件过大,请确认选对了文件')
      return
    }
    file.text().then((text) => set('secret', text))
  }

  return (
    <Modal
      title={editing ? `编辑服务器 - ${host.name}` : '添加服务器'}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className={ui.btn} onClick={runTest} disabled={!canSubmit || test.kind === 'running'} style={{ marginRight: 'auto' }}>
            {test.kind === 'running' ? '正在连接…' : '测试连接'}
          </button>
          <button className={ui.btn} onClick={onClose}>
            取消
          </button>
          <button className={ui.primary} onClick={save} disabled={!canSubmit || saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </>
      }
    >
      <div className={ui.row}>
        <div className={ui.field} style={{ flex: 3 }}>
          <label className={ui.label}>服务器地址</label>
          <input className={ui.input} value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="IP 或域名" autoFocus />
        </div>
        <div className={ui.field} style={{ flex: 1 }}>
          <label className={ui.label}>端口</label>
          <input className={ui.input} type="number" value={form.port} onChange={(e) => set('port', Number(e.target.value) || 0)} />
        </div>
      </div>
      <div className={ui.row}>
        <div className={ui.field}>
          <label className={ui.label}>用户名</label>
          <input className={ui.input} value={form.username} onChange={(e) => set('username', e.target.value)} />
        </div>
        <div className={ui.field}>
          <label className={ui.label}>显示名称(可选)</label>
          <input className={ui.input} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder={`${form.username || 'root'}@${form.address || 'host'}`} />
        </div>
      </div>
      <div className={ui.field}>
        <label className={ui.label}>认证方式</label>
        <div className={ui.segmented} style={{ alignSelf: 'flex-start' }}>
          {(['password', 'key'] as AuthType[]).map((type) => (
            <button key={type} className={form.authType === type ? ui.on : ''} onClick={() => set('authType', type)}>
              {type === 'password' ? '密码' : '私钥'}
            </button>
          ))}
        </div>
      </div>
      {form.authType === 'password' ? (
        <div className={ui.field}>
          <label className={ui.label}>密码</label>
          <input
            className={ui.input}
            type="password"
            value={form.secret}
            onChange={(e) => set('secret', e.target.value)}
            placeholder={secretRequired ? '' : '留空表示不修改'}
            autoComplete="new-password"
          />
        </div>
      ) : (
        <>
          <div className={ui.field}>
            <label className={ui.label} style={{ display: 'flex', alignItems: 'center' }}>
              <span style={{ flex: 1 }}>私钥内容</span>
              <button className={ui.btn} style={{ height: 24, padding: '0 8px', fontSize: 12 }} onClick={() => keyInput.current?.click()}>
                从文件读取
              </button>
              <input ref={keyInput} type="file" hidden onChange={(e) => loadKeyFile(e.target.files?.[0])} />
            </label>
            <textarea
              className={ui.textarea}
              value={form.secret}
              onChange={(e) => set('secret', e.target.value)}
              placeholder={secretRequired ? '-----BEGIN OPENSSH PRIVATE KEY-----' : '留空表示不修改'}
              spellCheck={false}
            />
          </div>
          <div className={ui.field}>
            <label className={ui.label}>私钥口令(没有就留空)</label>
            <input
              className={ui.input}
              type="password"
              value={form.passphrase}
              onChange={(e) => set('passphrase', e.target.value)}
              placeholder={editing && host.hasPassphrase && !form.secret ? '已设置,留空表示不修改' : ''}
              autoComplete="new-password"
            />
          </div>
        </>
      )}
      <div className={ui.field}>
        <label className={ui.label}>默认打开目录(可选)</label>
        <input className={ui.input} value={form.defaultDir} onChange={(e) => set('defaultDir', e.target.value)} placeholder="留空则打开用户主目录,如 /www/wwwroot" />
      </div>
      {editing && host.hostKey ? <div className={ui.hint}>主机指纹:{host.hostKey}</div> : null}
      <div className={ui.hint} style={{ marginTop: 4 }}>
        密码和私钥加密保存在本地数据库。首次连接会记住服务器指纹,之后指纹变化会拒绝连接。
      </div>
      {test.kind === 'ok' ? (
        <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 4, background: '#e8f5e9', color: 'var(--success)', fontSize: 12, lineHeight: 1.7 }}>
          连接成功。主目录 {test.info.home},指纹 {test.info.hostKey}
          <br />
          {test.info.hasShell
            ? `可用命令:${toolNames.filter((tool) => test.info.tools[tool]).join('、') || '无'}`
            : '该服务器不能执行命令,只能使用基础文件操作'}
        </div>
      ) : null}
      {test.kind === 'error' ? (
        <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 4, background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: 12, wordBreak: 'break-all' }}>
          {test.message}
        </div>
      ) : null}
    </Modal>
  )
}
