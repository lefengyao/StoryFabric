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
  /** 创作偏好映射出的原始模型温度；未设置时保持供应商默认行为。 */
  temperature?: number
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
  /** 工具调用开始；供应商只提供完整调用时在完整对象到达时触发。 */
  onToolCallStart?: (callId: string, name: string, index: number) => void
  /** 工具参数 JSON 的真实增量；调用方不得在此时执行工具。 */
  onToolArgsDelta?: (callId: string, delta: string, index: number) => void
  /** 工具参数完整收集结束。 */
  onToolCallComplete?: (callId: string, name: string, argsJson: string, index: number) => void
}

export interface LlmAdapter {
  stream(model: string, req: StreamRequest, apiKey: string, handlers: StreamHandlers): Promise<StreamResult>
}

export type LlmAdapterFactory = (protocol: Protocol, baseUrl: string, options?: { allowPrivateUrls?: boolean; fetcher?: typeof fetch; fallbackFetcher?: typeof fetch }) => LlmAdapter

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

export async function parseJsonResponse<T>(res: Response): Promise<T> {
  const contentType = res.headers.get('content-type') ?? ''
  const body = await res.text()
  try {
    return JSON.parse(body) as T
  } catch {
    if (/\b(?:text\/html|application\/xhtml\+xml)\b/i.test(contentType) || /^\s*(?:<!doctype\s+html\b|<html\b)/i.test(body)) {
      throw new Error(`模型列表接口返回了 HTML 页面（HTTP ${res.status}）。可能是系统代理认证/拦截页，也可能是 API Base URL 配置错误。请检查系统代理设置和 API Base URL。`)
    }
    throw new Error(`模型列表接口返回的不是有效 JSON（HTTP ${res.status}，Content-Type: ${contentType || '未知'}）。`)
  }
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

/** 仅对明确不支持 temperature 的客户端错误降级，其他服务端失败仍保留原有错误流。 */
export async function isUnsupportedTemperatureError(res: Response, temperature: number | undefined): Promise<boolean> {
  if (temperature === undefined || (res.status !== 400 && res.status !== 422)) return false
  const detail = await res.clone().text()
  let message = detail
  try {
    const json = JSON.parse(detail)
    if (isStructuredUnsupportedTemperatureError(json)) return true
    message = typeof json?.error?.message === 'string'
      ? json.error.message
      : typeof json?.message === 'string'
        ? json.message
        : detail
  } catch {
    /* 兼容纯文本错误响应 */
  }
  // 只处理“该参数不存在/额外/不支持”的明确能力错误。值范围、类型等校验失败必须原样抛出。
  return unsupportedTemperatureParameterPatterns.some((pattern) => pattern.test(message))
}

const unsupportedTemperatureParameterPatterns = [
    /\b(?:unknown|unrecognized|unsupported|unexpected)\s+(?:request\s+)?(?:parameter|field|argument|input)\s*[:=]?\s*[`"']?temperature\b/i,
    /\b(?:extra|additional)\s+(?:parameters?|fields?|arguments?|inputs?)\s+(?:are\s+)?(?:not\s+permitted|not\s+allowed)\s*[:\-]?\s*[`"']?temperature\b/i,
    /\b(?:parameter|field|argument|input)\s+[`"']?temperature\b\s+(?:is\s+)?(?:not\s+supported|unsupported)\b/i,
    /\btemperature\s+(?:parameter|field|argument|input)?\s*(?:is\s+)?(?:not\s+supported|unsupported)\b/i
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStructuredUnsupportedTemperatureError(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.detail)) return false
  return value.detail.some((item) => {
    if (!isRecord(item) || !Array.isArray(item.loc)) return false
    const locHasTemperature = item.loc.some((part) => typeof part === 'string' && part.toLowerCase() === 'temperature')
    if (!locHasTemperature) return false
    const type = typeof item.type === 'string' ? item.type.toLowerCase() : ''
    const message = typeof item.msg === 'string' ? item.msg : ''
    const explicitType = /^(?:extra(?:[_-](?:forbidden|field|input|inputs|parameter))?|(?:unknown|unrecognized|unsupported|unexpected)[_-](?:parameter|field|argument|input))$/.test(type)
    const explicitMessage = /\b(?:extra|additional)\s+(?:parameters?|fields?|arguments?|inputs?)\s+(?:are\s+)?(?:not\s+permitted|not\s+allowed)\b/i.test(message)
      || /\b(?:unknown|unrecognized|unsupported|unexpected)\s+(?:request\s+)?(?:parameter|field|argument|input)\b/i.test(message)
      || unsupportedTemperatureParameterPatterns.some((pattern) => pattern.test(message))
    return explicitType || explicitMessage
  })
}
