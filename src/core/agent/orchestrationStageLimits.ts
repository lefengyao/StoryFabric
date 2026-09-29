import type { ChatMessage } from '../../shared/types'
import type { StageId } from '../orchestration/types'
import { estimateMessagesTokens } from './contextWindow'

/** The run-wide call budget must not become a single stage's tool-loop allowance. */
export function orchestrationStageRoundLimit(stageId: StageId, runMaxCalls: number): number {
  const stageLimit = stageId === 'write' ? 32 : 24
  return Math.max(1, Math.min(stageLimit, runMaxCalls))
}

export function orchestrationStageOutputLimit(stageId: StageId, configuredMaxOutput: number): number {
  const stageLimit = stageId === 'write' || stageId === 'polish' ? 32768 : 16384
  return Math.max(1, Math.min(stageLimit, configuredMaxOutput))
}

/** Keep the stage task and a suffix of whole assistant/tool exchanges. */
export function boundedStageMessages(messages: ChatMessage[], maxTokens: number): ChatMessage[] {
  if (messages.length <= 1) return messages
  const groups: ChatMessage[][] = []
  for (const message of messages.slice(1)) {
    if (message.role === 'tool' && groups.length > 0) groups[groups.length - 1].push(message)
    else groups.push([message])
  }

  let tokens = estimateMessagesTokens(messages.slice(0, 1))
  const retained: ChatMessage[][] = []
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index]
    const cost = estimateMessagesTokens(group)
    if (retained.length > 0 && tokens + cost > maxTokens) break
    retained.unshift(group)
    tokens += cost
  }
  return [messages[0], ...retained.flat()]
}
