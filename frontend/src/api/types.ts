export type AuthType = 'password' | 'key'

export interface Host {
  id: number
  name: string
  address: string
  port: number
  username: string
  authType: AuthType
  hasPassphrase: boolean
  hostKey: string
  defaultDir: string
  sortOrder: number
}

export interface HostForm {
  id?: number
  name: string
  address: string
  port: number
  username: string
  authType: AuthType
  secret: string
  passphrase: string
  defaultDir: string
  sortOrder: number
}

export interface HostInfo {
  home: string
  hasShell: boolean
  tools: Record<string, boolean>
  hostKey: string
}

export type EntryType = 'dir' | 'file' | 'link' | 'other'

export interface Entry {
  name: string
  path: string
  type: EntryType
  isDir: boolean
  size: number
  mode: string
  mtime: number
  owner: string
  group: string
  target?: string
  broken?: boolean
}

export type TaskStatus = 'running' | 'done' | 'failed' | 'canceled'

export interface Touched {
  hostId: number
  dir: string
}

export interface ServerTask {
  id: string
  kind: string
  title: string
  status: TaskStatus
  progress: number
  message: string
  error: string
  touched: Touched[] | null
  createdAt: number
  finishedAt: number
}

export interface Bookmark {
  id: number
  hostId: number
  name: string
  path: string
}

export type Conflict = 'skip' | 'overwrite' | 'rename'

export type ArchiveFormat = 'zip' | 'tar.gz' | 'tar.bz2' | 'tar.xz' | 'tar'
