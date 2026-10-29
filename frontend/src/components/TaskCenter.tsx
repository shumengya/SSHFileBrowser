import { useTasks, type UploadItem } from '../state/tasks'
import type { ServerTask } from '../api/types'
import { formatSize } from '../utils/format'
import { Icon } from './Icon'
import styles from './TaskCenter.module.css'

const uploadLabel: Record<UploadItem['status'], string> = {
  queued: '等待中',
  uploading: '上传中',
  done: '已完成',
  error: '失败',
  canceled: '已取消',
}

const taskLabel: Record<ServerTask['status'], string> = {
  running: '进行中',
  done: '已完成',
  failed: '失败',
  canceled: '已取消',
}

// 右上角弹出的"传输与任务"面板:上传队列 + 服务器后台任务(复制/移动/压缩/解压)
export function TaskCenter() {
  const tasks = useTasks()
  if (!tasks.panelOpen) return null
  const uploads = [...tasks.uploads].reverse()
  const empty = uploads.length === 0 && tasks.serverTasks.length === 0

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <strong>传输与任务</strong>
        <button className={styles.link} onClick={tasks.clearFinished}>
          清除已完成
        </button>
        <button className={styles.close} onClick={() => tasks.setPanelOpen(false)} title="收起">
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className={styles.list}>
        {empty ? <div className={styles.empty}>没有进行中的任务</div> : null}
        {tasks.serverTasks.map((task) => (
          <div key={task.id} className={styles.item}>
            <Icon name={task.kind === 'paste' ? 'copy' : task.kind === 'compress' ? 'archive' : 'extract'} size={16} className={styles.kindIcon} />
            <div className={styles.info}>
              <div className={styles.name} title={task.title}>
                {task.title}
              </div>
              {task.status === 'running' ? <Progress value={task.progress} /> : null}
              <div className={`${styles.meta} ${task.status === 'failed' ? styles.failed : ''}`} title={task.error || task.message}>
                {task.status === 'failed' ? task.error : task.status === 'running' ? task.message || taskLabel[task.status] : taskLabel[task.status]}
              </div>
            </div>
            {task.status === 'running' ? (
              <button className={styles.cancel} onClick={() => tasks.cancelServerTask(task.id)} title="取消">
                <Icon name="close" size={14} />
              </button>
            ) : null}
          </div>
        ))}
        {uploads.map((item) => {
          const active = item.status === 'queued' || item.status === 'uploading'
          return (
            <div key={item.id} className={styles.item}>
              <Icon name="upload" size={16} className={styles.kindIcon} />
              <div className={styles.info}>
                <div className={styles.name} title={`${item.dir}/${item.name}`}>
                  {item.name}
                </div>
                {item.status === 'uploading' ? <Progress value={item.file.size ? item.loaded / item.file.size : -1} /> : null}
                <div className={`${styles.meta} ${item.status === 'error' ? styles.failed : ''}`} title={item.error}>
                  {item.status === 'uploading'
                    ? `${formatSize(item.loaded)} / ${formatSize(item.file.size)}`
                    : item.status === 'error'
                      ? item.error
                      : `${uploadLabel[item.status]} · ${formatSize(item.file.size)}`}
                </div>
              </div>
              {active ? (
                <button className={styles.cancel} onClick={() => tasks.cancelUpload(item.id)} title="取消">
                  <Icon name="close" size={14} />
                </button>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Progress({ value }: { value: number }) {
  const indeterminate = value < 0
  return (
    <div className={styles.track}>
      <div
        className={indeterminate ? styles.barIndeterminate : styles.bar}
        style={indeterminate ? undefined : { width: `${Math.round(Math.min(1, value) * 100)}%` }}
      />
    </div>
  )
}
