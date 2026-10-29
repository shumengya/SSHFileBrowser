import type { Entry } from '../../api/types'
import { compareName } from '../../utils/format'
import { typeLabel } from '../../utils/fileTypes'

export type SortKey = 'name' | 'mtime' | 'type' | 'size' | 'mode' | 'owner' | 'location'

export interface Sort {
  key: SortKey
  asc: boolean
}

export type ViewMode = 'details' | 'grid'

export type ModalState =
  | { kind: 'permission'; entries: Entry[] }
  | { kind: 'properties'; entry: Entry }
  | { kind: 'compress'; entries: Entry[] }
  | { kind: 'extract'; entry: Entry }
  | { kind: 'editor'; entry: Entry }
  | { kind: 'preview'; entry: Entry }

export interface SearchState {
  keyword: string
  root: string
  entries: Entry[]
  truncated: boolean
  loading: boolean
}

// 文件夹永远排在前面,其余按所选列排序,相同时按名称自然排序
export function sortEntries(list: Entry[], sort: Sort): Entry[] {
  const factor = sort.asc ? 1 : -1
  return [...list].sort((left, right) => {
    if (left.isDir !== right.isDir) return left.isDir ? -1 : 1
    let result = 0
    if (sort.key === 'size') result = left.size - right.size
    if (sort.key === 'mtime') result = left.mtime - right.mtime
    if (sort.key === 'type') result = compareName(typeLabel(left), typeLabel(right))
    if (sort.key === 'mode') result = left.mode.localeCompare(right.mode)
    if (sort.key === 'owner') result = compareName(left.owner, right.owner)
    if (sort.key === 'location') result = compareName(left.path, right.path)
    return (result || compareName(left.name, right.name)) * factor
  })
}
