import type { ChatMessage, ToolCallData } from '../../shared/types'
import type { AgentQuestion, SkillCandidate } from '../../shared/agentQuestions'
import type { StreamResult } from '../llm/types'
import { isLikelyPlaceholderResponse } from './responseGuards'

export interface ToolLoopWaitingUser {
  question: AgentQuestion
  toolCall: ToolCallData
}

export interface ToolLoopWaitingSkillCandidate {
  candidate: SkillCandidate
  toolCall: ToolCallData
}

export interface ToolLoopResult {
  text: string
  toolCalls: ToolCallData[]
  rounds: number
  stoppedReason?: 'completed' | 'repeated-tool-calls' | 'tool-failure' | 'max-rounds' | 'waiting-user' | 'empty-response'
  waitingUser?: ToolLoopWaitingUser
  waitingCandidate?: ToolLoopWaitingSkillCandidate
}

export interface ToolLoopToolResult {
  ok: boolean
  text: string
  preview: string
  waitingUser?: AgentQuestion
  waitingCandidate?: SkillCandidate
}

export interface ToolLoopOptions {
  getMessages: () => ChatMessage[]
  appendMessage: (message: ChatMessage) => void
  maxRounds: number
  /** Give a stage one chance to finish from already-read evidence after a tool cycle. */
  recoverRepeatedToolCalls?: boolean
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
  const canonicalArgs = (argsJson: string): string => {
    try {
      const sortKeys = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(sortKeys)
        if (value && typeof value === 'object') {
          return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortKeys(item)]))
        }
        return value
      }
      return JSON.stringify(sortKeys(JSON.parse(argsJson)))
    } catch {
      return argsJson.trim()
    }
  }
  return calls.map((call) => `${call.name}:${canonicalArgs(call.argsJson)}`).sort().join('\n')
}

function repeatingToolCycle(signatures: string[]): number | null {
  for (let period = 1; period <= 3; period += 1) {
    if (signatures.length < period * 3) continue
    const recent = signatures.slice(-period * 3)
    if (recent.every((signature, index) => signature === recent[index % period])) return period
  }
  return null
}

/**
 * Shared native-tool loop used by basic chat, orchestration stages, and child agents.
 * Plain-text tool markup is deliberately not parsed or executed here.
 */
export async function runToolLoop(options: ToolLoopOptions): Promise<ToolLoopResult> {
  const id = options.createMessageId ?? defaultMessageId
  const toolSignatures: string[] = []
  let blockedCycleSignatures: Set<string> | null = null
  const toolFailures = new Map<string, number>()
  let placeholderRetryUsed = false
  let emptyResponseRetryUsed = false
  let lastResult: StreamResult = { text: '', toolCalls: [], stopReason: 'stop' }

  for (let round = 0; round < options.maxRounds; round += 1) {
    const messageId = id('assistant')
    const result = await options.callModel({ round, messageId, messages: options.getMessages() })
    lastResult = result
    if (result.text?.trim() || result.toolCalls.length || (result.thinkingBlocks && result.thinkingBlocks.length > 0)) {
      options.appendMessage({
        id: messageId,
        role: 'assistant',
        text: result.text || undefined,
        toolCalls: result.toolCalls.length ? result.toolCalls : undefined,
        thinkingBlocks: result.thinkingBlocks
      })
    }

    if (!result.toolCalls.length) {
      if (!result.text?.trim()) {
        if (!emptyResponseRetryUsed) {
          emptyResponseRetryUsed = true
          options.appendMessage({
            id: id('guard'),
            role: 'user',
            text: '上一轮模型返回了空响应。请输出可见答复，或调用一个能推进任务的工具；不要以空内容结束。'
          })
          continue
        }
        return { text: '', toolCalls: [], rounds: round + 1, stoppedReason: 'empty-response' }
      }
      emptyResponseRetryUsed = false
      if (!placeholderRetryUsed && isLikelyPlaceholderResponse(result.text)) {
        placeholderRetryUsed = true
        options.appendMessage({
          id: id('guard'),
          role: 'user',
          text: '上一轮只说明了准备核查，没有实际调用工具。请立即调用能够核实工作区状态的工具，不要只输出准备动作。'
        })
        continue
      }
      return { text: result.text, toolCalls: [], rounds: round + 1, stoppedReason: 'completed' }
    }
    emptyResponseRetryUsed = false
    placeholderRetryUsed = false

    const signature = toolRoundSignature(result.toolCalls)
    toolSignatures.push(signature)
    if (toolSignatures.length > 9) toolSignatures.shift()
    const cycleLength = repeatingToolCycle(toolSignatures)
    if (cycleLength !== null && options.recoverRepeatedToolCalls && blockedCycleSignatures === null) {
      blockedCycleSignatures = new Set(toolSignatures.slice(-cycleLength))
      toolSignatures.length = 0
      for (const toolCall of result.toolCalls) {
        const toolResult: ToolLoopToolResult = {
          ok: false,
          text: '重复工具调用已阻止，本轮没有重新读取。请使用已有工具结果完成当前阶段。',
          preview: '重复读取已阻止'
        }
        options.onToolStart?.(toolCall)
        options.onToolDone?.(toolCall, toolResult)
        options.appendMessage({ id: id('tool'), role: 'tool', toolCallId: toolCall.id, toolName: toolCall.name, text: toolResult.text, isError: true })
      }
      options.appendMessage({
        id: id('guard'),
        role: 'user',
        text: '检测到重复读取。请直接依据已有工具结果完成当前阶段并输出最终内容；确实缺少信息时只查询新的具体资料，不要重复相同参数。'
      })
      continue
    }
    if (cycleLength !== null || blockedCycleSignatures?.has(signature)) {
      options.appendMessage({
        id: id('guard'),
        role: 'assistant',
        text: cycleLength === null
          ? '纠偏后仍重复读取相同资料，已停止以避免继续消耗。请调整要求后重试。'
          : `检测到工具调用按 ${cycleLength} 轮模式重复 3 次，已停止以避免循环。请调整要求后重试。`
      })
      return { text: result.text, toolCalls: result.toolCalls, rounds: round + 1, stoppedReason: 'repeated-tool-calls' }
    }

    // Control tools pause the run and therefore must be the only tool call in a model turn.
    // Return a concrete tool error for every call in a mixed batch so providers never see
    // an assistant tool-call list with missing tool results.
    if (result.toolCalls.length > 1 && result.toolCalls.some((toolCall) => toolCall.name === 'ask_user' || toolCall.name === 'propose_skill_package')) {
      for (const toolCall of result.toolCalls) {
        options.onToolStart?.(toolCall)
        const toolResult: ToolLoopToolResult = {
          ok: false,
          text: 'ask_user 或 propose_skill_package 必须作为本轮唯一工具调用，请重新提交单个控制工具调用。',
          preview: '控制工具不能与其它工具混用'
        }
        options.onToolDone?.(toolCall, toolResult)
        options.appendMessage({
          id: id('tool'),
          role: 'tool',
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          text: toolResult.text,
          isError: true
        })
      }
      continue
    }

    for (const toolCall of result.toolCalls) {
      options.onToolStart?.(toolCall)
      let toolResult: ToolLoopToolResult
      try {
        toolResult = await options.executeTool(toolCall)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        toolResult = { ok: false, text: `工具执行失败：${message}`, preview: '工具执行失败' }
      }
      options.onToolDone?.(toolCall, toolResult)
      if (toolResult.waitingUser) {
        return {
          text: result.text,
          toolCalls: result.toolCalls,
          rounds: round + 1,
          stoppedReason: 'waiting-user',
          waitingUser: { question: toolResult.waitingUser, toolCall }
        }
      }
      if (toolResult.waitingCandidate) {
        return {
          text: result.text,
          toolCalls: result.toolCalls,
          rounds: round + 1,
          stoppedReason: 'waiting-user',
          waitingCandidate: { candidate: toolResult.waitingCandidate, toolCall }
        }
      }
      options.appendMessage({
        id: id('tool'),
        role: 'tool',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        text: toolResult.text,
        isError: !toolResult.ok
      })
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
