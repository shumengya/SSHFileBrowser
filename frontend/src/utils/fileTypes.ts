import type { Entry } from '../api/types'

export type FileKind =
  | 'folder'
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'code'
  | 'text'
  | 'config'
  | 'pdf'
  | 'binary'
  | 'file'

const groups: Record<Exclude<FileKind, 'folder' | 'file'>, string[]> = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'avif'],
  video: ['mp4', 'webm', 'mkv', 'mov', 'avi', 'flv', 'm4v'],
  audio: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'],
  archive: ['zip', 'gz', 'tgz', 'bz2', 'tbz2', 'xz', 'txz', 'tar', 'rar', '7z', 'zst'],
  code: [
    'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'vue', 'go', 'py', 'rb', 'php', 'java', 'kt', 'c', 'h', 'cpp', 'hpp',
    'cc', 'cs', 'rs', 'swift', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'lua', 'pl', 'sql', 'html', 'htm', 'css',
    'scss', 'less', 'dart', 'r', 'scala',
  ],
  config: [
    'json', 'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'env', 'xml', 'properties', 'service', 'socket',
    'timer', 'lock', 'editorconfig', 'gitignore', 'dockerignore', 'htaccess',
  ],
  text: ['txt', 'md', 'markdown', 'log', 'csv', 'tsv', 'rst', 'nfo', 'srt', 'tex'],
  pdf: ['pdf'],
  binary: ['exe', 'dll', 'so', 'bin', 'o', 'a', 'deb', 'rpm', 'apk', 'iso', 'img', 'dmg', 'class', 'jar', 'pyc', 'woff', 'woff2', 'ttf', 'otf', 'db', 'sqlite'],
}

const lookup = new Map<string, FileKind>()
for (const [kind, extensions] of Object.entries(groups)) {
  for (const extension of extensions) lookup.set(extension, kind as FileKind)
}

// 常见的无扩展名文本文件
const textNames = new Set(['dockerfile', 'makefile', 'readme', 'license', 'authorized_keys', 'known_hosts', 'hosts', 'crontab', 'fstab', 'passwd', 'group', 'profile', 'bashrc', 'vimrc'])

export function extensionOf(name: string): string {
  const trimmed = name.replace(/^\.+/, '')
  const index = trimmed.lastIndexOf('.')
  return index < 0 ? '' : trimmed.slice(index + 1).toLowerCase()
}

export function kindOf(entry: Pick<Entry, 'name' | 'isDir'>): FileKind {
  if (entry.isDir) return 'folder'
  const extension = extensionOf(entry.name)
  const kind = lookup.get(extension)
  if (kind) return kind
  if (!extension || textNames.has(entry.name.toLowerCase().replace(/^\./, ''))) return 'text'
  return 'file'
}

export function isArchive(name: string): boolean {
  return /\.(zip|tar|tar\.gz|tgz|tar\.bz2|tbz2|tar\.xz|txz)$/i.test(name)
}

export type OpenAction = 'enter' | 'edit' | 'preview' | 'extract' | 'download'

// 双击时做什么:不认识的文件也先尝试用编辑器打开,后端判断是二进制再提示下载
export function openActionOf(entry: Entry): OpenAction {
  if (entry.isDir) return 'enter'
  const kind = kindOf(entry)
  if (kind === 'image' || kind === 'video' || kind === 'audio') return 'preview'
  if (kind === 'archive') return isArchive(entry.name) ? 'extract' : 'download'
  if (kind === 'binary' || kind === 'pdf') return 'download'
  return 'edit'
}

export function typeLabel(entry: Entry): string {
  if (entry.type === 'link' && entry.broken) return '失效的链接'
  if (entry.isDir) return entry.type === 'link' ? '文件夹链接' : '文件夹'
  if (entry.type === 'other') return '特殊文件'
  const extension = extensionOf(entry.name)
  const suffix = entry.type === 'link' ? '(链接)' : ''
  return (extension ? `${extension.toUpperCase()} 文件` : '文件') + suffix
}
