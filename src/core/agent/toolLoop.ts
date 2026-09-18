import type { ChatMessage, ToolCallData } from '../../shared/types'
import type { StreamResult } from '../llm/types'

export interface ToolLoopResult {
  text: string
  toolCalls: ToolCallData[]
  rounds: number
  stoppedReason?: 'completed' | 'repeated-tool-calls' | 'tool-failure' | 'max-rounds'
}

export interface ToolLoopToolResult {
  ok: boolean
  text: string
  preview: string
}

export interface ToolLoopOptions {
  getMessages: () => ChatMessage[]
  appendMessage: (message: ChatMessage) => void
  maxRounds: number
  createMessageId?: (kind: 'assistant' | 'tool' | 'guard') => string
  callModel: (input: { round: number; messageId: string; messages: ChatMessage[] }) => Promise<StreamResult>
  executeTool: (toolCall: ToolCallData) => Promise<ToolLoopToolResult>
  onToolStart?: (toolCall: ToolCallData) => void
  onToolDone?: (toolCall: ToolCallData, result: ToolLoopToolResult) => void
}

let sequence = 0

function defaultMessageId(kind: 'assistant' | 'tool' | 'guard'): string {
  sequence += 1
  return `msg_${Date.now().toString(36)}_${sequence.toString(36)}_${kind}`
}

function toolRoundSignature(calls: ToolCallData[]): string {
  return calls.map((call) => `${call.name}:${call.argsJson}`).sort().join('\n')
}

/**
 * Shared native-tool loop used by basic chat, orchestration stages, and child agents.
 * Plain-text tool markup is deliberately not parsed or executed here.
 */
export async function runToolLoop(options: ToolLoopOptions): Promise<ToolLoopResult> {
  const id = options.createMessageId ?? defaultMessageId
  let previousToolSignature = ''
  let repeatedToolRounds = 0
  const toolFailures = new Map<string, number>()
  let lastResult: StreamResult = { text: '', toolCalls: [], stopReason: 'stop' }

  for (let round = 0; round < options.maxRounds; round += 1) {
    const messageId = id('assistant')
    const result = await options.callModel({ round, messageId, messages: options.getMessages() })
    lastResult = result
    options.appendMessage({
      id: messageId,
      role: 'assistant',
      text: result.text || undefined,
      toolCalls: result.toolCalls.length ? result.toolCalls : undefined,
      thinkingBlocks: result.thinkingBlocks
    })

    if (!result.toolCalls.length) return { text: result.text, toolCalls: [], rounds: round + 1, stoppedReason: 'completed' }

    const signature = toolRoundSignature(result.toolCalls)
    repeatedToolRounds = signature === previousToolSignature ? repeatedToolRounds + 1 : 1
    previousToolSignature = signature
    if (repeatedToolRounds >= 3) {
      options.appendMessage({
        id: id('guard'),
        role: 'assistant',
        text: '检测到连续 3 轮调用完全相同的工具和参数，已停止以避免循环。请调整要求或继续对话后再试。'
      })
      return { text: result.text, toolCalls: result.toolCalls, rounds: round + 1, stoppedReason: 'repeated-tool-calls' }
    }

    for (const toolCall of result.toolCalls) {
      options.onToolStart?.(toolCall)
      const toolResult = await options.executeTool(toolCall)
      options.appendMessage({
        id: id('tool'),
        role: 'tool',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        text: toolResult.text,
        isError: !toolResult.ok
      })
      options.onToolDone?.(toolCall, toolResult)
      if (toolResult.ok) toolFailures.delete(toolCall.name)
      else {
        const failures = (toolFailures.get(toolCall.name) ?? 0) + 1
        toolFailures.set(toolCall.name, failures)
        if (failures >= 3) {
          options.appendMessage({
            id: id('guard'),
            role: 'assistant',
            text: `工具 ${toolCall.name} 连续参数或读取失败 3 次，已停止。请修正参数或补充资料后重试。`
          })
          return { text: result.text, toolCalls: result.toolCalls, rounds: round + 1, stoppedReason: 'tool-failure' }
        }
      }
    }
  }

  options.appendMessage({
    id: id('guard'),
    role: 'assistant',
    text: `⚠ 连续工具调用已达上限（${options.maxRounds} 轮），已停止。请继续对话以接着处理。`
  })
  return { text: lastResult.text, toolCalls: lastResult.toolCalls, rounds: options.maxRounds, stoppedReason: 'max-rounds' }
}
