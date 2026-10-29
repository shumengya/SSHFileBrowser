import { useCallback, useState } from 'react'

// 和 useState 一样,但值会记在 localStorage 里(视图模式、排序、显示隐藏文件)
export function useLocalState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw === null ? initial : (JSON.parse(raw) as T)
    } catch {
      return initial
    }
  })
  const update = useCallback(
    (next: T) => {
      setValue(next)
      localStorage.setItem(key, JSON.stringify(next))
    },
    [key],
  )
  return [value, update]
}

// navigator.clipboard 只在 HTTPS / localhost 可用,局域网 http 访问时退回老办法
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
    return
  }
  const area = document.createElement('textarea')
  area.value = text
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  const ok = document.execCommand('copy')
  area.remove()
  if (!ok) throw new Error('浏览器不允许写入剪贴板')
}

export interface PickedFile {
  file: File
  relativePath: string
}

// 拖进来的可能是文件夹,要用 Entry API 递归读出全部文件。
// webkitGetAsEntry 必须在 drop 事件同步阶段调用,所以先取 entries 再 await。
export async function filesFromDrop(transfer: DataTransfer): Promise<PickedFile[]> {
  const entries = Array.from(transfer.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry())
  const plain = Array.from(transfer.files)
  if (!entries.some(Boolean)) return plain.map((file) => ({ file, relativePath: file.name }))
  const picked: PickedFile[] = []
  for (const entry of entries) {
    if (entry) await walkEntry(entry, '', picked)
  }
  return picked
}

async function walkEntry(entry: FileSystemEntry, prefix: string, picked: PickedFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
    picked.push({ file, relativePath: prefix + entry.name })
    return
  }
  if (!entry.isDirectory) return
  const reader = (entry as FileSystemDirectoryEntry).createReader()
  // readEntries 每次最多返回 100 条,要一直读到空为止
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (batch.length === 0) break
    for (const child of batch) await walkEntry(child, `${prefix}${entry.name}/`, picked)
  }
}

export function filesFromInput(list: FileList): PickedFile[] {
  return Array.from(list).map((file) => ({ file, relativePath: file.webkitRelativePath || file.name }))
}
