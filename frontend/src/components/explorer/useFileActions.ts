import { fsApi, startDownload } from '../../api'
import { errorMessage } from '../../api/client'
import type { Entry } from '../../api/types'
import { emitRefresh } from '../../state/refresh'
import { copyText } from '../../utils/browser'
import { openActionOf } from '../../utils/fileTypes'
import { dirname, uniqueName } from '../../utils/path'
import { useDialog } from '../Dialogs'
import { useToast } from '../Toast'
import type { ExplorerContext } from './context'

export function useFileActions(ctx: ExplorerContext) {
  const toast = useToast()
  const dialog = useDialog()
  const { host, dir } = ctx

  // 自己刷新,同时通知其它打开着相关目录的标签页
  const changed = (dirs: string[], select?: string[]) => {
    dir.refresh(select)
    for (const path of new Set(dirs)) emitRefresh(host.id, path, ctx.origin)
  }

  const open = (entry: Entry) => {
    const action = openActionOf(entry)
    if (action === 'enter') {
      if (entry.broken) {
        toast.error('链接指向的目标不存在')
        return
      }
      void dir.openDir(entry.path)
      return
    }
    if (action === 'download') {
      startDownload(host.id, [entry.path])
      return
    }
    ctx.setModal({ kind: action === 'edit' ? 'editor' : action, entry })
  }

  const remove = async (entries: Entry[]) => {
    if (entries.length === 0) return
    const first = entries[0]
    const message =
      entries.length === 1
        ? `确定要永久删除「${first.name}」吗?${first.isDir ? '\n文件夹里的所有内容都会被删除。' : ''}\n此操作无法撤销。`
        : `确定要永久删除选中的 ${entries.length} 个项目吗?\n此操作无法撤销。`
    const ok = await dialog.confirm({ title: '删除', message, okText: '删除', danger: true })
    if (!ok) return
    try {
      await fsApi.remove(host.id, entries.map((entry) => entry.path))
      toast.success(entries.length === 1 ? `已删除 ${first.name}` : `已删除 ${entries.length} 个项目`)
    } catch (error) {
      toast.error(errorMessage(error))
    }
    // 失败也刷新:可能已经删掉了一部分
    changed(entries.map((entry) => dirname(entry.path)))
  }

  const rename = async (entry: Entry, name: string) => {
    ctx.setRenaming(null)
    const trimmed = name.trim()
    if (!trimmed || trimmed === entry.name) return
    if (trimmed.includes('/')) {
      toast.error('名称不能包含 /')
      return
    }
    try {
      const newPath = await fsApi.rename(host.id, entry.path, trimmed)
      changed([dirname(entry.path)], [newPath])
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  // 和资源管理器一样:先用默认名建好,再进入重命名
  const create = async (kind: 'folder' | 'file') => {
    if (dir.search || !dir.cwd) return
    const names = new Set(dir.entries.map((entry) => entry.name))
    const name = kind === 'folder' ? uniqueName('新建文件夹', names) : uniqueName('新建文本文档', names, '.txt')
    try {
      const path = kind === 'folder' ? await fsApi.mkdir(host.id, dir.cwd, name) : await fsApi.touch(host.id, dir.cwd, name)
      await dir.openDir(dir.cwd, { push: false, select: [path] })
      ctx.setRenaming(path)
      emitRefresh(host.id, dir.cwd, ctx.origin)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const copyPath = (paths: string[]) => {
    copyText(paths.join('\n'))
      .then(() => toast.success(paths.length === 1 ? '路径已复制' : `已复制 ${paths.length} 个路径`))
      .catch((error: unknown) => toast.error(errorMessage(error)))
  }

  const properties = async (entry?: Entry) => {
    if (entry) {
      ctx.setModal({ kind: 'properties', entry })
      return
    }
    try {
      ctx.setModal({ kind: 'properties', entry: await fsApi.stat(host.id, dir.cwd) })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  // 搜索结果里"打开所在位置"
  const reveal = (entry: Entry) => {
    void dir.openDir(dirname(entry.path), { select: [entry.path] })
  }

  return {
    changed,
    open,
    remove,
    rename,
    create,
    copyPath,
    properties,
    reveal,
    download: (entries: Entry[]) => {
      if (entries.length > 0) startDownload(host.id, entries.map((entry) => entry.path))
    },
    permission: (entries: Entry[]) => {
      if (entries.length > 0) ctx.setModal({ kind: 'permission', entries })
    },
    compress: (entries: Entry[]) => {
      if (entries.length > 0 && !dir.search) ctx.setModal({ kind: 'compress', entries })
    },
    extract: (entry: Entry) => ctx.setModal({ kind: 'extract', entry }),
    edit: (entry: Entry) => ctx.setModal({ kind: 'editor', entry }),
    bookmark: (path: string) => ctx.onAddBookmark(path),
  }
}

export type FileActions = ReturnType<typeof useFileActions>
