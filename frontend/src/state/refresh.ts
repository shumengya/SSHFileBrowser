// 某台服务器的某个目录有变化,打开着这个目录的标签页收到后自行刷新。
// origin 是发起方标签页的标识,发起方自己已经刷新过,不用重复刷新。
const EVENT = 'sfb:refresh'

export interface RefreshDetail {
  hostId: number
  dir: string
  origin?: string
}

export function emitRefresh(hostId: number, dir: string, origin?: string) {
  window.dispatchEvent(new CustomEvent<RefreshDetail>(EVENT, { detail: { hostId, dir, origin } }))
}

export function onRefresh(handler: (detail: RefreshDetail) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<RefreshDetail>).detail)
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
