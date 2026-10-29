import { useEffect, useState } from 'react'
import { downloadUrl, startDownload } from '../../api'
import type { Entry, Host } from '../../api/types'
import { kindOf } from '../../utils/fileTypes'
import { formatSize } from '../../utils/format'
import { Icon } from '../Icon'
import { Modal } from '../Modal'
import ui from '../../styles/ui.module.css'
import styles from './Preview.module.css'

interface Props {
  host: Host
  entry: Entry
  siblings: Entry[]
  onClose: () => void
}

// 图片/视频/音频预览,←→ 切换同目录下的同类文件
export function PreviewModal({ host, entry, siblings, onClose }: Props) {
  const [current, setCurrent] = useState(entry)
  const [zoom, setZoom] = useState(1)
  const [failed, setFailed] = useState(false)
  const kind = kindOf(current)
  const list = siblings.filter((item) => kindOf(item) === kind)
  const index = list.findIndex((item) => item.path === current.path)

  const step = (offset: number) => {
    if (list.length < 2) return
    setCurrent(list[(index + offset + list.length) % list.length])
    setZoom(1)
    setFailed(false)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') step(1)
      if (event.key === 'ArrowLeft') step(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const url = downloadUrl(host.id, [current.path], true)

  return (
    <Modal
      title={`${current.name}  ·  ${formatSize(current.size)}${list.length > 1 ? `  ·  ${index + 1} / ${list.length}` : ''}`}
      onClose={onClose}
      width="min(1100px, calc(100vw - 48px))"
      height="calc(100vh - 64px)"
      bodyClassName={styles.body}
    >
      <div className={styles.stage}>
        {failed ? (
          <div className={styles.message}>
            <div>浏览器无法预览这个文件</div>
            <button className={ui.primary} onClick={() => startDownload(host.id, [current.path])}>
              下载
            </button>
          </div>
        ) : null}
        {!failed && kind === 'image' ? (
          <img key={url} src={url} alt={current.name} className={styles.image} style={{ transform: `scale(${zoom})` }} onError={() => setFailed(true)} />
        ) : null}
        {!failed && kind === 'video' ? <video key={url} src={url} controls autoPlay className={styles.media} onError={() => setFailed(true)} /> : null}
        {!failed && kind === 'audio' ? <audio key={url} src={url} controls autoPlay onError={() => setFailed(true)} /> : null}
        {list.length > 1 ? (
          <>
            <button className={`${styles.nav} ${styles.prev}`} onClick={() => step(-1)} title="上一个 (←)">
              <Icon name="chevronLeft" size={22} />
            </button>
            <button className={`${styles.nav} ${styles.next}`} onClick={() => step(1)} title="下一个 (→)">
              <Icon name="chevronRight" size={22} />
            </button>
          </>
        ) : null}
      </div>
      <div className={styles.bar}>
        {kind === 'image' ? (
          <>
            <button className={styles.tool} onClick={() => setZoom(Math.max(0.1, zoom / 1.25))} title="缩小">
              <Icon name="zoomOut" size={16} />
            </button>
            <span className={styles.zoom}>{Math.round(zoom * 100)}%</span>
            <button className={styles.tool} onClick={() => setZoom(Math.min(10, zoom * 1.25))} title="放大">
              <Icon name="zoomIn" size={16} />
            </button>
            <button className={styles.tool} onClick={() => setZoom(1)} title="原始比例">
              1:1
            </button>
          </>
        ) : null}
        <span style={{ flex: 1 }} />
        <button className={ui.btn} onClick={() => startDownload(host.id, [current.path])}>
          <Icon name="download" size={14} />
          下载
        </button>
      </div>
    </Modal>
  )
}
