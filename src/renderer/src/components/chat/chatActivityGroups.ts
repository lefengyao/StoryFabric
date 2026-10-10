import type { ChatMessage, RunActivitySummary } from '../../../../shared/types'
import type { LiveTurnItem } from '../../stores/chatStore'

export interface ActivityTool {
  callId: string
  name: string
  argsJson?: string
  status: 'running' | 'pending' | 'ok' | 'error'
  preview?: string
  resultText?: string
}

export type ChatActivityGroup =
  | { kind: 'message'; message: ChatMessage }
  | { kind: 'activity'; id: string; tools: ActivityTool[]; activity?: RunActivitySummary; failed?: boolean }

export function mergeLiveActivityTools(persistedTools: readonly ActivityTool[], timeline: readonly LiveTurnItem[]): ActivityTool[] {
  const tools = [...persistedTools]
  const persistedById = new Map<string, number[]>()
  for (let index = 0; index < persistedTools.length; index++) {
    const indexes = persistedById.get(persistedTools[index].callId) ?? []
    indexes.push(index)
    persistedById.set(persistedTools[index].callId, indexes)
  }

  // A stream can emit pending -> running -> done updates for one occurrence, while
  // some providers reuse the same call ID for a later occurrence. Terminal rows
  // therefore start a new live occurrence; active rows absorb compatible updates.
  const liveItems = timeline.filter((item): item is Extract<LiveTurnItem, { kind: 'tool' }> => item.kind === 'tool')
  const occurrenceByItem = new Map<number, number>()
  const liveCounts = new Map<string, number>()
  const activeById = new Map<string, { occurrence: number; item: Extract<LiveTurnItem, { kind: 'tool' }> }>()
  for (let itemIndex = 0; itemIndex < liveItems.length; itemIndex++) {
    const item = liveItems[itemIndex]
    const active = activeById.get(item.callId)
    const same = active && !isTerminal(active.item.status) && compatibleToolSignature(active.item, item)
    const occurrence = same ? active.occurrence : (liveCounts.get(item.callId) ?? 0)
    occurrenceByItem.set(itemIndex, occurrence)
    if (!same) liveCounts.set(item.callId, occurrence + 1)
    activeById.set(item.callId, { occurrence, item })
  }

  const outputByOccurrence = new Map<string, number>()
  const persistedMatchByOccurrence = new Map<string, number>()
  const persistedUsed = new Set<number>()
  for (let itemIndex = 0; itemIndex < liveItems.length; itemIndex++) {
    const item = liveItems[itemIndex]
    const occurrence = occurrenceByItem.get(itemIndex) ?? 0
    const key = `${item.callId}\0${occurrence}`
    let outputIndex = outputByOccurrence.get(key)
    if (outputIndex === undefined) {
      const indexes = persistedById.get(item.callId) ?? []
      const liveCount = liveCounts.get(item.callId) ?? 0
      const offset = Math.max(0, indexes.length - liveCount)
      const candidate = indexes[offset + occurrence]
      if (candidate !== undefined && !persistedUsed.has(candidate) && compatibleToolSignature(persistedTools[candidate], item)) {
        outputIndex = candidate
        persistedUsed.add(candidate)
        persistedMatchByOccurrence.set(key, candidate)
      } else {
        outputIndex = tools.length
        tools.push({ callId: item.callId, name: item.name, argsJson: item.argsJson, status: item.status, ...(item.preview !== undefined && { preview: item.preview }) })
      }
      outputByOccurrence.set(key, outputIndex)
    }
    const previous = tools[outputIndex]
    const persisted = persistedMatchByOccurrence.has(key) ? persistedTools[persistedMatchByOccurrence.get(key)!] : undefined
    tools[outputIndex] = {
      ...previous,
      name: persisted?.name ?? previous.name,
      argsJson: persisted?.argsJson ?? item.argsJson,
      status: persisted && isTerminal(persisted.status) ? persisted.status : item.status,
      ...(item.preview !== undefined && { preview: item.preview })
    }
  }
  return tools
}

function isTerminal(status: ActivityTool['status']): boolean {
  return status === 'ok' || status === 'error'
}

function compatibleToolSignature(left: Pick<ActivityTool, 'name' | 'argsJson'>, right: Pick<ActivityTool, 'name' | 'argsJson'>): boolean {
  if (left.name !== right.name) return false
  if (!left.argsJson || !right.argsJson) return true
  const leftArgs = liveArgsPrefix(left.argsJson)
  const rightArgs = liveArgsPrefix(right.argsJson)
  return leftArgs === rightArgs || leftArgs.startsWith(rightArgs) || rightArgs.startsWith(leftArgs)
}

function liveArgsPrefix(argsJson: string): string {
  const marker = '\n…工具参数过长，已省略…'
  return argsJson.length === 12000 && argsJson.endsWith(marker) ? argsJson.slice(0, -marker.length) : argsJson
}

export function buildChatActivityGroups(messages: readonly ChatMessage[]): ChatActivityGroup[] {
  const groups: ChatActivityGroup[] = []
  let turnStart = 0
  for (let index = 1; index <= messages.length; index++) {
    if (index === messages.length || messages[index].role === 'user') {
      appendTurn(groups, messages, turnStart, index)
      turnStart = index
    }
  }
  return groups
}

function appendTurn(groups: ChatActivityGroup[], messages: readonly ChatMessage[], start: number, end: number): void {
  if (start === end) return
  const turnGroups: ChatActivityGroup[] = []
  const tools: ActivityTool[] = []
  const pendingById = new Map<string, { tools: ActivityTool[]; next: number }>()
  const summaries: RunActivitySummary[] = []
  let failed = false
  let toolPosition: number | undefined
  let summaryPosition: number | undefined

  for (let index = start; index < end; index++) {
    const message = messages[index]
    if (message.role === 'assistant' && message.isError) failed = true
    if (message.role !== 'tool') {
      const toolOnly = message.role === 'assistant' && message.toolCalls?.length && !message.text && !message.files?.length
      const activityOnly = message.role === 'assistant' && Boolean(message.runActivity) && !message.text && !message.files?.length && !message.toolCalls?.length
      if (!toolOnly && !activityOnly) turnGroups.push({ kind: 'message', message })
    }
    if (message.runActivity) {
      summaries.push(message.runActivity)
      summaryPosition ??= turnGroups.length
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
      toolPosition ??= turnGroups.length
      for (const call of message.toolCalls) {
        const tool: ActivityTool = { callId: call.id, name: call.name, argsJson: call.argsJson, status: 'pending' }
        tools.push(tool)
        const pending = pendingById.get(call.id) ?? { tools: [], next: 0 }
        pending.tools.push(tool)
        pendingById.set(call.id, pending)
      }
    }
    if (message.role === 'tool') {
      toolPosition ??= turnGroups.length
      const pending = message.toolCallId ? pendingById.get(message.toolCallId) : undefined
      const tool = pending?.tools[pending.next]
      if (tool && pending) {
        pending.next++
        tool.status = message.isError ? 'error' : 'ok'
        tool.resultText = message.text
        if (message.toolName) tool.name = message.toolName
      } else {
        tools.push({
          callId: message.toolCallId ?? message.id,
          name: message.toolName ?? 'tool',
          status: message.isError ? 'error' : 'ok',
          resultText: message.text
        })
      }
    }
  }

  const position = toolPosition ?? summaryPosition
  if (position !== undefined) {
    const activityGroup: ChatActivityGroup = { kind: 'activity', id: `activity:${messages[start].id}`, tools, ...(failed && { failed: true }) }
    if (summaries.length) activityGroup.activity = mergeSummaries(summaries)
    turnGroups.splice(position, 0, activityGroup)
  }
  groups.push(...turnGroups)
}

function mergeSummaries(summaries: RunActivitySummary[]): RunActivitySummary {
  const skills = new Map<string, { skill: RunActivitySummary['skills'][number]; stages: Set<string> }>()
  const tools = new Map<string, RunActivitySummary['tools'][number]>()
  const rules = new Map<string, RunActivitySummary['rules'][number]>()
  for (const summary of summaries) {
    for (const skill of summary.skills) {
      const key = JSON.stringify([skill.packageId, skill.skillId, skill.version])
      const entry = skills.get(key) ?? { skill: { ...skill, stages: [] }, stages: new Set<string>() }
      for (const stage of skill.stages) {
        if (!entry.stages.has(stage)) {
          entry.stages.add(stage)
          entry.skill.stages.push(stage)
        }
      }
      skills.set(key, entry)
    }
    for (const tool of summary.tools) {
      const previous = tools.get(tool.name)
      // Repeated final-message evidence is cumulative, so it must not inflate counts.
      tools.set(tool.name, { name: tool.name, count: Math.max(previous?.count ?? 0, tool.count), failed: Math.max(previous?.failed ?? 0, tool.failed) })
    }
    for (const rule of summary.rules) {
      rules.set(JSON.stringify([rule.source, rule.id, rule.target, rule.key]), { ...rule })
    }
  }
  return { skills: [...skills.values()].map((entry) => entry.skill), tools: [...tools.values()], rules: [...rules.values()] }
}
