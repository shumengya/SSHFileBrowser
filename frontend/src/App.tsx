import { useCallback, useEffect, useState } from 'react'
import { authApi } from './api'
import { errorMessage, UNAUTHORIZED_EVENT } from './api/client'
import { DialogProvider } from './components/Dialogs'
import { ToastProvider } from './components/Toast'
import { Login } from './components/Login'
import { Workspace } from './components/Workspace'
import { ClipboardProvider } from './state/clipboard'
import { TaskProvider } from './state/tasks'
import ui from './styles/ui.module.css'

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'auth'; initialized: boolean }
  | { kind: 'ready'; username: string }

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })

  const check = useCallback(() => {
    setPhase({ kind: 'loading' })
    authApi
      .status()
      .then((status) =>
        setPhase(status.username ? { kind: 'ready', username: status.username } : { kind: 'auth', initialized: status.initialized }),
      )
      .catch((error: unknown) => setPhase({ kind: 'error', message: errorMessage(error) }))
  }, [])

  useEffect(() => {
    check()
    // 任何接口返回 401(会话过期、在别处改了密码)都回到登录页
    const onUnauthorized = () => setPhase({ kind: 'auth', initialized: true })
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [check])

  return (
    <ToastProvider>
      <DialogProvider>
        {phase.kind === 'loading' ? (
          <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
            <span className={ui.spinner} />
          </div>
        ) : null}
        {phase.kind === 'error' ? (
          <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
            <div style={{ textAlign: 'center' }}>
              <p>无法连接后端:{phase.message}</p>
              <button className={ui.primary} onClick={check}>
                重试
              </button>
            </div>
          </div>
        ) : null}
        {phase.kind === 'auth' ? (
          <Login initialized={phase.initialized} onDone={(username) => setPhase({ kind: 'ready', username })} />
        ) : null}
        {phase.kind === 'ready' ? (
          <ClipboardProvider>
            <TaskProvider>
              <Workspace username={phase.username} onLogout={() => setPhase({ kind: 'auth', initialized: true })} />
            </TaskProvider>
          </ClipboardProvider>
        ) : null}
      </DialogProvider>
    </ToastProvider>
  )
}
