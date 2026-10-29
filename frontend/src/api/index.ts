import type { AxiosProgressEvent, GenericAbortSignal } from 'axios'
import { http } from './client'
import type { ArchiveFormat, Bookmark, Conflict, Entry, Host, HostForm, HostInfo, ServerTask } from './types'

export const authApi = {
  status: () => http.get<{ initialized: boolean; username: string }>('/auth/status').then((r) => r.data),
  setup: (username: string, password: string) =>
    http.post<{ username: string }>('/auth/setup', { username, password }).then((r) => r.data),
  login: (username: string, password: string) =>
    http.post<{ username: string }>('/auth/login', { username, password }).then((r) => r.data),
  logout: () => http.post('/auth/logout'),
  changePassword: (oldPassword: string, newPassword: string) =>
    http.post('/auth/password', { oldPassword, newPassword }),
}

export const hostApi = {
  list: () => http.get<Host[]>('/hosts').then((r) => r.data),
  create: (form: HostForm) => http.post<Host>('/hosts', form).then((r) => r.data),
  update: (form: HostForm) => http.put<Host>(`/hosts/${form.id}`, form).then((r) => r.data),
  remove: (id: number) => http.delete(`/hosts/${id}`),
  test: (form: HostForm) => http.post<HostInfo>('/hosts/test', form, { timeout: 40000 }).then((r) => r.data),
  connect: (id: number) =>
    http.post<{ info: HostInfo; host: Host }>(`/hosts/${id}/connect`).then((r) => r.data),
  trust: (id: number, fingerprint: string) => http.post(`/hosts/${id}/trust`, { fingerprint }),
}

export const bookmarkApi = {
  list: (hostId: number) => http.get<Bookmark[]>(`/hosts/${hostId}/bookmarks`).then((r) => r.data),
  create: (hostId: number, name: string, path: string) =>
    http.post<Bookmark>(`/hosts/${hostId}/bookmarks`, { name, path }).then((r) => r.data),
  remove: (hostId: number, id: number) => http.delete(`/hosts/${hostId}/bookmarks/${id}`),
}

const fsBase = (hostId: number) => `/hosts/${hostId}/fs`

export const fsApi = {
  list: (hostId: number, path: string, signal?: GenericAbortSignal) =>
    http
      .get<{ path: string; entries: Entry[] }>(`${fsBase(hostId)}/list`, { params: { path }, signal })
      .then((r) => r.data),
  stat: (hostId: number, path: string) =>
    http.get<Entry>(`${fsBase(hostId)}/stat`, { params: { path } }).then((r) => r.data),
  read: (hostId: number, path: string) =>
    http.get<{ content: string }>(`${fsBase(hostId)}/content`, { params: { path } }).then((r) => r.data.content),
  write: (hostId: number, path: string, content: string) =>
    http.put(`${fsBase(hostId)}/content`, { path, content }),
  mkdir: (hostId: number, dir: string, name: string) =>
    http.post<{ path: string }>(`${fsBase(hostId)}/mkdir`, { dir, name }).then((r) => r.data.path),
  touch: (hostId: number, dir: string, name: string) =>
    http.post<{ path: string }>(`${fsBase(hostId)}/touch`, { dir, name }).then((r) => r.data.path),
  rename: (hostId: number, path: string, newName: string) =>
    http.post<{ path: string }>(`${fsBase(hostId)}/rename`, { path, newName }).then((r) => r.data.path),
  remove: (hostId: number, paths: string[]) =>
    http.post(`${fsBase(hostId)}/delete`, { paths }, { timeout: 0 }),
  chmod: (hostId: number, paths: string[], mode: string, recursive: boolean) =>
    http.post(`${fsBase(hostId)}/chmod`, { paths, mode, recursive }),
  chown: (hostId: number, paths: string[], owner: string, group: string, recursive: boolean) =>
    http.post(`${fsBase(hostId)}/chown`, { paths, owner, group, recursive }),
  search: (hostId: number, path: string, keyword: string, signal?: GenericAbortSignal) =>
    http
      .get<{ entries: Entry[]; truncated: boolean }>(`${fsBase(hostId)}/search`, {
        params: { path, keyword },
        signal,
      })
      .then((r) => r.data),
  size: (hostId: number, path: string) =>
    http.get<{ size: number }>(`${fsBase(hostId)}/size`, { params: { path } }).then((r) => r.data.size),
  paste: (
    hostId: number,
    body: { sourceHostId: number; paths: string[]; targetDir: string; move: boolean; conflict: Conflict },
  ) => http.post<ServerTask>(`${fsBase(hostId)}/paste`, body).then((r) => r.data),
  compress: (hostId: number, dir: string, paths: string[], name: string, format: ArchiveFormat) =>
    http.post<ServerTask>(`${fsBase(hostId)}/compress`, { dir, paths, name, format }).then((r) => r.data),
  extract: (hostId: number, path: string, destDir: string, overwrite: boolean) =>
    http.post<ServerTask>(`${fsBase(hostId)}/extract`, { path, destDir, overwrite }).then((r) => r.data),
  // 请求体直接是文件内容,后端边收边写,不经过 multipart
  upload: (
    hostId: number,
    dir: string,
    name: string,
    file: Blob,
    overwrite: boolean,
    onProgress: (event: AxiosProgressEvent) => void,
    signal: GenericAbortSignal,
  ) =>
    http.post(`${fsBase(hostId)}/upload`, file, {
      params: { dir, name, overwrite: overwrite ? 1 : 0 },
      headers: { 'Content-Type': 'application/octet-stream' },
      onUploadProgress: onProgress,
      signal,
      timeout: 0,
    }),
}

export function downloadUrl(hostId: number, paths: string[], inline = false): string {
  const params = new URLSearchParams()
  for (const path of paths) params.append('path', path)
  if (inline) params.set('inline', '1')
  return `/api${fsBase(hostId)}/download?${params.toString()}`
}

// 下载靠 cookie 鉴权,直接让浏览器跳转,大文件不经过 JS 内存
export function startDownload(hostId: number, paths: string[]) {
  const link = document.createElement('a')
  link.href = downloadUrl(hostId, paths)
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export const taskApi = {
  list: () => http.get<ServerTask[]>('/tasks').then((r) => r.data),
  cancel: (id: string) => http.post(`/tasks/${id}/cancel`),
  remove: (id: string) => http.delete(`/tasks/${id}`),
  clear: () => http.delete('/tasks'),
}
