import type { Entry } from '../api/types'
import { extensionOf, kindOf, type FileKind } from '../utils/fileTypes'

const colors: Record<FileKind, string> = {
  folder: '#f0b93a',
  image: '#2f9e5b',
  video: '#c2410c',
  audio: '#c026d3',
  archive: '#8b5a2b',
  code: '#2563eb',
  text: '#6b7280',
  config: '#0d9488',
  pdf: '#dc2626',
  binary: '#475569',
  file: '#94a3b8',
}

interface Props {
  entry: Pick<Entry, 'name' | 'isDir' | 'type' | 'broken'>
  size?: number
}

// Windows 11 风格:黄色文件夹;文件是折角纸张,底部色带按类型着色,大图标时显示扩展名
export function FileIcon({ entry, size = 20 }: Props) {
  const kind = kindOf(entry)
  const isLink = entry.type === 'link'
  const badge = isLink ? (
    <g>
      <rect x="1" y="21" width="10" height="10" rx="2" fill="#fff" stroke="#9ca3af" strokeWidth="0.8" />
      <path d="M4 28l4-4M5.5 24H8v2.5" fill="none" stroke={entry.broken ? '#dc2626' : '#2563eb'} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  ) : null
  if (kind === 'folder') {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ flexShrink: 0 }}>
        <path d="M2 7a2 2 0 012-2h7.2a2 2 0 011.5.7L14.5 8H28a2 2 0 012 2v15a2 2 0 01-2 2H4a2 2 0 01-2-2z" fill="#e8a317" />
        <path d="M2 11a2 2 0 012-2h24a2 2 0 012 2v14a2 2 0 01-2 2H4a2 2 0 01-2-2z" fill="#ffc83d" />
        {badge}
      </svg>
    )
  }
  const extension = extensionOf(entry.name).slice(0, 4).toUpperCase()
  const color = colors[kind]
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M7 2h12l7 7v19a2 2 0 01-2 2H7a2 2 0 01-2-2V4a2 2 0 012-2z" fill="#fff" stroke="#b8bec7" strokeWidth="1" />
      <path d="M19 2v5a2 2 0 002 2h5" fill="#e5e7eb" stroke="#b8bec7" strokeWidth="1" />
      {size >= 32 && extension ? (
        <>
          <rect x="3" y="17" width="20" height="9" rx="1.5" fill={color} />
          <text x="13" y="23.6" textAnchor="middle" fontSize="6.4" fontWeight="700" fill="#fff" fontFamily="Segoe UI, Arial, sans-serif">
            {extension}
          </text>
        </>
      ) : (
        <rect x="9" y="19" width="13" height="3.2" rx="1" fill={color} />
      )}
      {badge}
    </svg>
  )
}
