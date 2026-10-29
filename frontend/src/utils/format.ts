const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(value >= 10 ? 1 : 2)} ${units[unit]}`
}

const pad = (value: number) => String(value).padStart(2, '0')

export function formatTime(unixSeconds: number): string {
  if (!unixSeconds) return '-'
  const date = new Date(unixSeconds * 1000)
  return (
    `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

// "0755" -> "rwxr-xr-x",带上 setuid/setgid/sticky
export function modeString(mode: string): string {
  const value = parseInt(mode, 8)
  if (Number.isNaN(value)) return mode
  const flags = 'rwxrwxrwx'.split('')
  let text = ''
  for (let bit = 0; bit < 9; bit++) {
    text += value & (1 << (8 - bit)) ? flags[bit] : '-'
  }
  const chars = text.split('')
  if (value & 0o4000) chars[2] = chars[2] === 'x' ? 's' : 'S'
  if (value & 0o2000) chars[5] = chars[5] === 'x' ? 's' : 'S'
  if (value & 0o1000) chars[8] = chars[8] === 'x' ? 't' : 'T'
  return chars.join('')
}

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

// 自然排序:file2 排在 file10 前面,和 Windows 资源管理器一致
export function compareName(left: string, right: string): number {
  return collator.compare(left, right)
}
