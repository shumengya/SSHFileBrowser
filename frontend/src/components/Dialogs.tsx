import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { Modal } from './Modal'
import ui from '../styles/ui.module.css'

interface ConfirmOptions {
  title: string
  message: ReactNode
  okText?: string
  danger?: boolean
}

interface PromptOptions {
  title: string
  label?: string
  value?: string
  okText?: string
  // 返回错误文案表示不通过
  validate?: (value: string) => string | null
}

interface Choice<T> {
  value: T
  label: string
  primary?: boolean
  danger?: boolean
}

interface ChooseOptions<T> {
  title: string
  message: ReactNode
  choices: Choice<T>[]
}

interface DialogApi {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  prompt: (options: PromptOptions) => Promise<string | null>
  choose: <T>(options: ChooseOptions<T>) => Promise<T | null>
}

const DialogContext = createContext<DialogApi | null>(null)

type Pending = { id: number; render: (close: () => void) => ReactNode; close: () => void }

let nextId = 1

// 命令式弹窗:await dialog.confirm(...),比到处维护 open 状态省事
export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending[]>([])

  const open = useCallback((render: Pending['render']) => {
    const id = nextId++
    const close = () => setPending((list) => list.filter((item) => item.id !== id))
    setPending((list) => [...list, { id, render, close }])
  }, [])

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        open((dismiss) => <ConfirmView options={options} onDone={(value) => { resolve(value); dismiss() }} />)
      }),
    [open],
  )

  const prompt = useCallback(
    (options: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        open((dismiss) => <PromptView options={options} onDone={(value) => { resolve(value); dismiss() }} />)
      }),
    [open],
  )

  const choose = useCallback(
    <T,>(options: ChooseOptions<T>) =>
      new Promise<T | null>((resolve) => {
        open((dismiss) => (
          <Modal
            title={options.title}
            onClose={() => { resolve(null); dismiss() }}
            footer={options.choices.map((choice) => (
              <button
                key={String(choice.value)}
                className={choice.danger ? ui.danger : choice.primary ? ui.primary : ui.btn}
                onClick={() => { resolve(choice.value); dismiss() }}
              >
                {choice.label}
              </button>
            ))}
          >
            <div style={{ lineHeight: 1.7 }}>{options.message}</div>
          </Modal>
        ))
      }),
    [open],
  )

  const api = useMemo<DialogApi>(() => ({ confirm, prompt, choose }), [confirm, prompt, choose])

  return (
    <DialogContext.Provider value={api}>
      {children}
      {pending.map((item) => (
        <DialogSlot key={item.id} item={item} />
      ))}
    </DialogContext.Provider>
  )
}

function DialogSlot({ item }: { item: Pending }) {
  return <>{item.render(item.close)}</>
}

function ConfirmView({ options, onDone }: { options: ConfirmOptions; onDone: (value: boolean) => void }) {
  return (
    <Modal
      title={options.title}
      onClose={() => onDone(false)}
      footer={
        <>
          <button className={ui.btn} onClick={() => onDone(false)}>
            取消
          </button>
          <button className={options.danger ? ui.danger : ui.primary} onClick={() => onDone(true)} autoFocus>
            {options.okText ?? '确定'}
          </button>
        </>
      }
    >
      <div style={{ lineHeight: 1.7, wordBreak: 'break-all', whiteSpace: 'pre-line' }}>{options.message}</div>
    </Modal>
  )
}

function PromptView({ options, onDone }: { options: PromptOptions; onDone: (value: string | null) => void }) {
  const [value, setValue] = useState(options.value ?? '')
  const [error, setError] = useState<string | null>(null)
  const submit = () => {
    const problem = options.validate?.(value) ?? null
    if (problem) {
      setError(problem)
      return
    }
    onDone(value)
  }
  return (
    <Modal
      title={options.title}
      onClose={() => onDone(null)}
      footer={
        <>
          <button className={ui.btn} onClick={() => onDone(null)}>
            取消
          </button>
          <button className={ui.primary} onClick={submit}>
            {options.okText ?? '确定'}
          </button>
        </>
      }
    >
      <div className={ui.field}>
        {options.label ? <label className={ui.label}>{options.label}</label> : null}
        <input
          className={ui.input}
          value={value}
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => { setValue(event.target.value); setError(null) }}
          onKeyDown={(event) => { if (event.key === 'Enter') submit() }}
        />
        {error ? <span className={ui.error}>{error}</span> : null}
      </div>
    </Modal>
  )
}

export function useDialog(): DialogApi {
  const api = useContext(DialogContext)
  if (!api) throw new Error('useDialog 必须在 DialogProvider 里使用')
  return api
}
