import type { DragEvent } from 'react'
import { fsApi } from '../../api'
import { errorMessage } from '../../api/client'
import type { Conflict, Entry } from '../../api/types'
import { useClipboard } from '../../state/clipboard'
import { useTasks } from '../../state/tasks'
import { filesFromDrop, type PickedFile } from '../../utils/browser'
import { basename, dirname } from '../../utils/path'
import { useDialog } from '../Dialogs'
import { useToast } from '../Toast'
import type { ExplorerContext } from './context'
import { readDrag } from './dnd'

interface Source {
  hostId: number
  paths: string[]
}

// 复制/剪切/粘贴、拖放、上传:先在前端检查重名并询问,再交给后端任务执行
export function useTransfer(ctx: ExplorerContext) {
  const toast = useToast()
  const dialog = useDialog()
  const tasks = useTasks()
  const clipboard = useClipboard()
  const { host, dir } = ctx

  const existingNames = async (targetDir: string) => {
    if (targetDir === dir.cwd && !dir.search) return new Set(dir.entries.map((entry) => entry.name))
    const result = await fsApi.list(host.id, targetDir)
    return new Set(result.entries.map((entry) => entry.name))
  }

  const transfer = async (source: Source, targetDir: string, move: boolean, fromClipboard: boolean) => {
    const sameHost = source.hostId === host.id
    if (sameHost && move && source.paths.every((path) => dirname(path) === targetDir)) return
    if (sameHost && source.paths.some((path) => targetDir === path || targetDir.startsWith(path + '/'))) {
      toast.error('不能把文件夹复制或移动到它自己里面')
      return
    }
    try {
      const names = await existingNames(targetDir)
      // 同目录复制由后端自动生成"副本",不算冲突
      const clashes = source.paths.filter((path) => names.has(basename(path)) && !(sameHost && dirname(path) === targetDir))
      let conflict: Conflict = 'skip'
      if (clashes.length > 0) {
        const choice = await dialog.choose<Conflict>({
          title: '替换或跳过文件',
          message:
            clashes.length === 1
              ? `目标文件夹中已经有名为「${basename(clashes[0])}」的项目。`
              : `目标文件夹中已经有 ${clashes.length} 个同名项目。`,
          choices: [
            { value: 'overwrite', label: '替换', danger: true },
            { value: 'rename', label: '保留两者' },
            { value: 'skip', label: '跳过', primary: true },
          ],
        })
        if (!choice) return
        conflict = choice
      }
      const task = await fsApi.paste(host.id, { sourceHostId: source.hostId, paths: source.paths, targetDir, move, conflict })
      tasks.trackServerTask(task)
      if (move && fromClipboard) clipboard.set(null)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const setClipboard = (mode: 'copy' | 'cut', entries: Entry[]) => {
    if (entries.length === 0) return
    clipboard.set({ mode, hostId: host.id, hostName: host.name, paths: entries.map((entry) => entry.path) })
    toast.info(`已${mode === 'copy' ? '复制' : '剪切'} ${entries.length} 项`)
  }

  const paste = (targetDir = dir.cwd) => {
    const data = clipboard.data
    if (!data || !targetDir || (dir.search && targetDir === dir.cwd)) return
    void transfer({ hostId: data.hostId, paths: data.paths }, targetDir, data.mode === 'cut', true)
  }

  const upload = async (files: PickedFile[], targetDir = dir.cwd) => {
    if (files.length === 0 || !targetDir) return
    let list = files
    let overwrite = false
    try {
      const names = await existingNames(targetDir)
      const topOf = (file: PickedFile) => file.relativePath.split('/')[0]
      const clashes = [...new Set(files.map(topOf))].filter((name) => names.has(name))
      if (clashes.length > 0) {
        const choice = await dialog.choose<'overwrite' | 'skip'>({
          title: '上传',
          message:
            clashes.length === 1
              ? `目标文件夹中已经有「${clashes[0]}」,要替换吗?`
              : `目标文件夹中已经有 ${clashes.length} 个同名项目,要替换吗?`,
          choices: [
            { value: 'overwrite', label: '替换', danger: true },
            { value: 'skip', label: '跳过同名项', primary: true },
          ],
        })
        if (!choice) return
        overwrite = choice === 'overwrite'
        if (!overwrite) list = files.filter((file) => !clashes.includes(topOf(file)))
      }
    } catch (error) {
      toast.error(errorMessage(error))
      return
    }
    if (list.length === 0) return
    tasks.enqueueUploads(list.map((file) => ({ hostId: host.id, dir: targetDir, name: file.relativePath, file: file.file, overwrite })))
  }

  // 拖放:应用内拖动默认移动、按住 Ctrl 复制;从系统拖进来的是上传
  const drop = (event: DragEvent, targetDir: string) => {
    const internal = readDrag(event.dataTransfer)
    if (internal) {
      void transfer(internal, targetDir, !(event.ctrlKey || event.metaKey), false)
      return
    }
    if (!event.dataTransfer.types.includes('Files')) return
    filesFromDrop(event.dataTransfer)
      .then((files) => upload(files, targetDir))
      .catch((error: unknown) => toast.error(`读取拖入的文件失败:${errorMessage(error)}`))
  }

  return { setClipboard, paste, upload, drop, clipboard: clipboard.data }
}

export type TransferActions = ReturnType<typeof useTransfer>
