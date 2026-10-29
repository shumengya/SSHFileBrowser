import { useEffect, useMemo, useRef, useState } from 'react'
import { fsApi, startDownload } from '../../api'
import { ApiError, errorMessage } from '../../api/client'
import type { Entry, Host } from '../../api/types'
import { useLocalState } from '../../utils/browser'
import { useDialog } from '../Dialogs'
import { Icon } from '../Icon'
import { Modal } from '../Modal'
import { useToast } from '../Toast'
import { cursorInfo, detectIndent, handleEditorKey } from './editorKeys'
import ui from '../../styles/ui.module.css'
import styles from './Editor.module.css'

interface Props {
  host: Host
  entry: Entry
  onClose: () => void
  onSaved: () => void
}

type Load = { state: 'loading' } | { state: 'ready' } | { state: 'error'; message: string; code: string }

export function EditorModal({ host, entry, onClose, onSaved }: Props) {
  const toast = useToast()
  const dialog = useDialog()
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [text, setText] = useState('')
  const [saved, setSaved] = useState('')
  const [crlf, setCrlf] = useState(false)
  const [saving, setSaving] = useState(false)
  const [wrap, setWrap] = useLocalState('sfb.editor.wrap', false)
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const dirty = load.state === 'ready' && text !== saved
  const indent = useMemo(() => detectIndent(saved), [saved])

  useEffect(() => {
    fsApi
      .read(host.id, entry.path)
      .then((content) => {
        // textarea 内部统一用 \n,保存时再按原来的换行符写回
        const windows = content.includes('\r\n')
        const normalized = windows ? content.replace(/\r\n/g, '\n') : content
        setCrlf(windows)
        setText(normalized)
        setSaved(normalized)
        setLoad({ state: 'ready' })
        window.setTimeout(() => areaRef.current?.focus(), 0)
      })
      .catch((error: unknown) =>
        setLoad({ state: 'error', message: errorMessage(error), code: error instanceof ApiError ? error.code : '' }),
      )
  }, [host.id, entry.path])

  const save = async () => {
    if (saving) return
    setSaving(true)
    const snapshot = text
    try {
      await fsApi.write(host.id, entry.path, crlf ? snapshot.replace(/\n/g, '\r\n') : snapshot)
      setSaved(snapshot)
      toast.success('已保存')
      onSaved()
    } catch (error) {
      toast.error(`保存失败:${errorMessage(error)}`)
    } finally {
      setSaving(false)
    }
  }

  const requestClose = async () => {
    if (dirty) {
      const ok = await dialog.confirm({ title: '未保存的更改', message: `「${entry.name}」有未保存的修改,确定要关闭吗?`, okText: '不保存,关闭', danger: true })
      if (!ok) return
    }
    onClose()
  }

  const lineCount = useMemo(() => text.split('\n').length, [text])
  const gutter = useMemo(() => Array.from({ length: lineCount }, (_, index) => index + 1).join('\n'), [lineCount])

  const title = (
    <span className={styles.title}>
      <Icon name="edit" size={15} />
      <span className={styles.path} title={entry.path}>
        {entry.path}
      </span>
      {dirty ? <span className={styles.dirty}>● 未保存</span> : null}
    </span>
  )

  return (
    <Modal title={title} onClose={() => void requestClose()} width="min(1200px, calc(100vw - 48px))" height="calc(100vh - 48px)" bodyClassName={styles.body}>
      <div className={styles.toolbar}>
        <button className={ui.primary} style={{ height: 28 }} onClick={() => void save()} disabled={!dirty || saving}>
          <Icon name="save" size={14} />
          {saving ? '保存中…' : '保存 (Ctrl+S)'}
        </button>
        <button className={`${ui.btn} ${wrap ? styles.toggleOn : ''}`} style={{ height: 28 }} onClick={() => setWrap(!wrap)}>
          <Icon name="wrap" size={14} />
          自动换行
        </button>
        <span className={styles.spacer} />
        <span className={styles.meta}>
          行 {cursor.line},列 {cursor.column} · {lineCount} 行 · UTF-8 · {crlf ? 'CRLF' : 'LF'} · 缩进 {indent === '\t' ? 'Tab' : `${indent.length} 空格`}
        </span>
      </div>
      {load.state === 'loading' ? (
        <div className={styles.center}>
          <span className={ui.spinner} />
        </div>
      ) : null}
      {load.state === 'error' ? (
        <div className={styles.center}>
          <div>{load.message}</div>
          {load.code === 'BINARY' || load.code === 'TOO_LARGE' ? (
            <button className={ui.primary} onClick={() => startDownload(host.id, [entry.path])}>
              下载文件
            </button>
          ) : null}
        </div>
      ) : null}
      {load.state === 'ready' ? (
        <div className={styles.editor}>
          {!wrap ? (
            <div ref={gutterRef} className={styles.gutter} aria-hidden="true">
              {gutter}
            </div>
          ) : null}
          <textarea
            ref={areaRef}
            className={`${styles.area} ${wrap ? styles.wrap : ''}`}
            value={text}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            onChange={(event) => setText(event.target.value)}
            onScroll={(event) => {
              if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop
            }}
            onSelect={(event) => setCursor(cursorInfo(event.currentTarget.value, event.currentTarget.selectionStart))}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault()
                void save()
                return
              }
              handleEditorKey(event, indent)
            }}
          />
        </div>
      ) : null}
    </Modal>
  )
}
