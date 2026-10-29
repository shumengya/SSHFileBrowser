import axios, { AxiosError } from 'axios'

// 自定义头是后端 CSRF 校验的依据,所有请求都带上
export const http = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: { 'X-Requested-With': 'sshfilebrowser' },
})

export class ApiError extends Error {
  status: number
  code: string
  fingerprint?: string

  constructor(message: string, status: number, code: string, fingerprint?: string) {
    super(message)
    this.status = status
    this.code = code
    this.fingerprint = fingerprint
  }
}

interface ErrorBody {
  code?: string
  message?: string
  fingerprint?: string
}

export const UNAUTHORIZED_EVENT = 'sfb:unauthorized'

http.interceptors.response.use(undefined, (error: AxiosError<ErrorBody>) => {
  if (axios.isCancel(error)) {
    return Promise.reject(error)
  }
  const status = error.response?.status ?? 0
  const body = error.response?.data
  const message =
    body && typeof body === 'object' && body.message
      ? body.message
      : status === 0
        ? '无法连接后端服务'
        : `请求失败(${status})`
  const code = body && typeof body === 'object' && body.code ? body.code : 'UNKNOWN'
  // 登录接口自己的 401 是"密码错误",不触发全局登出
  if (status === 401 && !error.config?.url?.startsWith('/auth/')) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
  }
  return Promise.reject(new ApiError(message, status, code, body?.fingerprint))
})

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export function isCanceled(error: unknown): boolean {
  return axios.isCancel(error)
}
