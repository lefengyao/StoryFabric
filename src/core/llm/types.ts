/** LLM 协议适配层公共类型 */
import type { ChatMessage, Protocol, ReasoningLevel, ReasoningMap, ToolCallData, ToolDefJson } from '../../shared/types'

export interface StreamRequest {
  /** 系统提示词（各协议自行放到正确位置） */
  system: string
  /** 规范化历史消息，不含 system 角色 */
  messages: ChatMessage[]
  tools: ToolDefJson[]
  signal?: AbortSignal
  /** 该模型的参数（平台层按供应商设置解析后注入；缺省时用协议默认值） */
  params?: ModelParams
}

export interface ModelParams {
  reasoning: ReasoningLevel
  /** 用户声明优先；缺省时 `buildModelParams` 回落到内置档案 */
  reasoningSupport?: boolean
  /** 官方思考强度映射；缺省或该等级没填时回落内置形式 */
  reasoningMap?: ReasoningMap
  contextTokens: number
  maxOutputTokens: number
}

export interface StreamResult {
  text: string
  toolCalls: ToolCallData[]
  stopReason: 'stop' | 'tool_calls'
  usage?: TokenUsage
  /** Anthropic 扩展思考块（原样回传用），其他协议不产生 */
  thinkingBlocks?: unknown[]
}

/** 单次模型调用用量：三家协议的字段已归一，缺失项为 0。 */
export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  /** 命中提示词缓存的输入 token（OpenAI `cached_tokens` / Anthropic `cache_read_input_tokens` / Gemini `cachedContentTokenCount`） */
  cachedTokens: number
  /** 为建立缓存而写入的输入 token（仅 Anthropic 有 `cache_creation_input_tokens`） */
  cacheWriteTokens: number
}

export interface StreamHandlers {
  /** 增量文本回调 */
  onText: (delta: string) => void
}

export interface LlmAdapter {
  stream(model: string, req: StreamRequest, apiKey: string, handlers: StreamHandlers): Promise<StreamResult>
}

export type LlmAdapterFactory = (protocol: Protocol, baseUrl: string) => LlmAdapter

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

