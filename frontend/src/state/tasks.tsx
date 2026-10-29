import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { fsApi, taskApi } from '../api'
import { errorMessage, isCanceled } from '../api/client'
import type { ServerTask } from '../api/types'
import { useToast } from '../components/Toast'
import { emitRefresh } from './refresh'

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'error' | 'canceled'

export interface UploadItem {
  id: number
  hostId: number
  dir: string
  name: string // 相对路径,文件夹上传时形如 a/b/c.txt
  file: File
  overwrite: boolean
  status: UploadStatus
  loaded: number
  error: string
  controller: AbortController
}

export interface UploadRequest {
  hostId: number
  dir: string
  name: string
  file: File
  overwrite: boolean
}

interface TaskApi {
  uploads: UploadItem[]
  serverTasks: ServerTask[]
  panelOpen: boolean
  setPanelOpen: (open: boolean) => void
  enqueueUploads: (requests: UploadRequest[]) => void
  cancelUpload: (id: number) => void
  trackServerTask: (task: ServerTask) => void
  cancelServerTask: (id: string) => void
  clearFinished: () => void
  activeCount: number
}

const TaskContext = createContext<TaskApi | null>(null)

const CONCURRENCY = 3
let nextUploadId = 1

export function TaskProvider({ children }: { children: ReactNode }) {
  const toast = useToast()
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [serverTasks, setServerTasks] = useState<ServerTask[]>([])
  const [panelOpen, setPanelOpen] = useState(false)
  // 上传列表放 ref 里改,渲染节流;否则每个进度事件都会整页重绘
  const uploadsRef = useRef<UploadItem[]>([])
  const flushTimer = useRef(0)
  const statusRef = useRef(new Map<string, string>())
  const pollTimer = useRef(0)
  const loadedOnce = useRef(false)

  const flush = useCallback((immediate = false) => {
    if (immediate) {
      window.clearTimeout(flushTimer.current)
      flushTimer.current = 0
      setUploads([...uploadsRef.current])
      return
    }
    if (flushTimer.current) return
    flushTimer.current = window.setTimeout(() => {
      flushTimer.current = 0
      setUploads([...uploadsRef.current])
    }, 200)
  }, [])

  const pump = useCallback(() => {
    const list = uploadsRef.current
    let running = list.filter((item) => item.status === 'uploading').length
    for (const item of list) {
      if (running >= CONCURRENCY) break
      if (item.status !== 'queued') continue
      running++
      item.status = 'uploading'
      fsApi
        .upload(item.hostId, item.dir, item.name, item.file, item.overwrite, (event) => {
          item.loaded = event.loaded
          flush()
        }, item.controller.signal)
        .then(() => {
          item.status = 'done'
          item.loaded = item.file.size
        })
        .catch((error: unknown) => {
          if (isCanceled(error)) {
            item.status = 'canceled'
            return
          }
          item.status = 'error'
          item.error = errorMessage(error)
        })
        .finally(() => {
          // 同一目录的这一批全部结束才刷新,避免几百个文件刷几百次
          const batchLeft = uploadsRef.current.some(
            (other) => other.hostId === item.hostId && other.dir === item.dir && (other.status === 'queued' || other.status === 'uploading'),
          )
          if (!batchLeft) emitRefresh(item.hostId, item.dir)
          if (item.status === 'error') toast.error(`上传 ${item.name} 失败:${item.error}`)
          flush(true)
          pump()
        })
    }
    flush(true)
  }, [flush, toast])

  const enqueueUploads = useCallback(
    (requests: UploadRequest[]) => {
      const items = requests.map<UploadItem>((request) => ({
        ...request,
        id: nextUploadId++,
        status: 'queued',
        loaded: 0,
        error: '',
        controller: new AbortController(),
      }))
      uploadsRef.current = [...uploadsRef.current, ...items]
      setPanelOpen(true)
      pump()
    },
    [pump],
  )

  const cancelUpload = useCallback(
    (id: number) => {
      const item = uploadsRef.current.find((entry) => entry.id === id)
      if (!item) return
      if (item.status === 'queued') item.status = 'canceled'
      item.controller.abort()
      flush(true)
    },
    [flush],
  )

  const poll = useCallback(async () => {
    window.clearTimeout(pollTimer.current)
    let tasks: ServerTask[] = []
    try {
      tasks = await taskApi.list()
    } catch {
      pollTimer.current = window.setTimeout(() => void poll(), 5000)
      return
    }
    const previous = statusRef.current
    // 第一次拉取时已结束的任务是历史记录,不弹提示
    const firstLoad = !loadedOnce.current
    loadedOnce.current = true
    for (const task of tasks) {
      const before = previous.get(task.id)
      if (!firstLoad && before === 'running' && task.status !== 'running') {
        for (const touched of task.touched ?? []) emitRefresh(touched.hostId, touched.dir)
        if (task.status === 'failed') toast.error(`${task.title} 失败:${task.error}`)
        if (task.status === 'done') toast.success(`${task.title} 已完成`)
      }
    }
    statusRef.current = new Map(tasks.map((task) => [task.id, task.status]))
    setServerTasks(tasks)
    // 有任务在跑时每秒刷新进度,否则低频轮询(别的浏览器窗口也可能发起任务)
    const running = tasks.some((task) => task.status === 'running')
    pollTimer.current = window.setTimeout(() => void poll(), running ? 1000 : 10000)
  }, [toast])

  useEffect(() => {
    void poll()
    return () => window.clearTimeout(pollTimer.current)
  }, [poll])

  const trackServerTask = useCallback(
    (task: ServerTask) => {
      statusRef.current.set(task.id, task.status)
      setServerTasks((list) => [task, ...list.filter((item) => item.id !== task.id)])
      setPanelOpen(true)
      void poll()
    },
    [poll],
  )

  const cancelServerTask = useCallback(
    (id: string) => {
      taskApi
        .cancel(id)
        .then(() => poll())
        .catch((error: unknown) => toast.error(errorMessage(error)))
    },
    [poll, toast],
  )

  const clearFinished = useCallback(() => {
    uploadsRef.current = uploadsRef.current.filter((item) => item.status === 'queued' || item.status === 'uploading')
    flush(true)
    taskApi
      .clear()
      .then(() => poll())
      .catch((error: unknown) => toast.error(errorMessage(error)))
  }, [flush, poll, toast])

  const activeCount =
    uploads.filter((item) => item.status === 'queued' || item.status === 'uploading').length +
    serverTasks.filter((task) => task.status === 'running').length

  const api = useMemo<TaskApi>(
    () => ({
      uploads,
      serverTasks,
      panelOpen,
      setPanelOpen,
      enqueueUploads,
      cancelUpload,
      trackServerTask,
      cancelServerTask,
      clearFinished,
      activeCount,
    }),
    [uploads, serverTasks, panelOpen, enqueueUploads, cancelUpload, trackServerTask, cancelServerTask, clearFinished, activeCount],
  )

  return <TaskContext.Provider value={api}>{children}</TaskContext.Provider>
}

export function useTasks(): TaskApi {
  const api = useContext(TaskContext)
  if (!api) throw new Error('useTasks 必须在 TaskProvider 里使用')
  return api
}
