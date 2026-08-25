/** LLM 协议适配层公共类型 */
import type { ChatMessage, ToolCallData, ToolDefJson } from '../../shared/types'

export interface StreamRequest {
  /** 系统提示词（各协议自行放到正确位置） */
  system: string
  /** 规范化历史消息，不含 system 角色 */
  messages: ChatMessage[]
  tools: ToolDefJson[]
  signal?: AbortSignal
}

export interface StreamResult {
  text: string
  toolCalls: ToolCallData[]
  stopReason: 'stop' | 'tool_calls'
}

export interface StreamHandlers {
  /** 增量文本回调 */
  onText: (delta: string) => void
}

export interface LlmAdapter {
  stream(model: string, req: StreamRequest, apiKey: string, handlers: StreamHandlers): Promise<StreamResult>
}

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/** 将非 2xx 响应转为含服务端信息的 Error */
export async function httpError(res: Response): Promise<Error> {
  let detail = ''
  try {
    const text = await res.text()
    try {
      const json = JSON.parse(text)
      detail = json?.error?.message ?? json?.message ?? text
    } catch {
      detail = text
    }
  } catch {
    /* 忽略读取失败 */
  }
  return new Error(`请求失败 HTTP ${res.status}${detail ? `：${detail.slice(0, 400)}` : ''}`)
}

export class AbortedError extends Error {
  constructor() {
    super('已中止')
    this.name = 'AbortedError'
  }
}
