// 远端一律是 POSIX 路径
export function joinPath(dir: string, name: string): string {
  return dir === '/' ? `/${name}` : `${dir}/${name}`
}

export function dirname(path: string): string {
  if (path === '/') return '/'
  const index = path.lastIndexOf('/')
  return index <= 0 ? '/' : path.slice(0, index)
}

export function basename(path: string): string {
  if (path === '/') return '/'
  return path.slice(path.lastIndexOf('/') + 1)
}

// 地址栏输入:支持 ~、相对路径、..,统一成干净的绝对路径
export function resolvePath(input: string, cwd: string, home: string): string {
  let raw = input.trim()
  if (raw === '' || raw === '~') return home
  if (raw.startsWith('~/')) raw = joinPath(home, raw.slice(2))
  if (!raw.startsWith('/')) raw = joinPath(cwd, raw)
  const parts: string[] = []
  for (const part of raw.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return '/' + parts.join('/')
}

export interface Crumb {
  name: string
  path: string
}

export function crumbs(path: string): Crumb[] {
  const list: Crumb[] = [{ name: '/', path: '/' }]
  let current = ''
  for (const part of path.split('/')) {
    if (!part) continue
    current += '/' + part
    list.push({ name: part, path: current })
  }
  return list
}

// 生成不重名的名字:新建文件夹、新建文件夹 (2) ……
export function uniqueName(base: string, existing: Set<string>, extension = ''): string {
  if (!existing.has(base + extension)) return base + extension
  for (let index = 2; index < 1000; index++) {
    const candidate = `${base} (${index})${extension}`
    if (!existing.has(candidate)) return candidate
  }
  return `${base} ${Date.now()}${extension}`
}
