import type { ChatMessage, ChatSession, ToolDefJson } from '../../shared/types'
import type { ToolOutcome } from '../tools/registry'

const STAGE_MESSAGE_ID = /^run_[a-z0-9]+_[a-z0-9]+_(?:plan|setting|prompt|anti-ai|write|polish|review)_(?:assistant|tool|guard|answer)_/i

export const ORCHESTRATION_HISTORY_TOOL_DEFS: ToolDefJson[] = [
  {
    name: 'list_orchestration_runs',
    description: '列出当前会话保留的编排运行及阶段产物摘要。产物是候选，不代表已经写回项目。',
    parameters: { type: 'object', additionalProperties: false, properties: {} }
  },
  {
    name: 'read_orchestration_artifact',
    description: '按当前会话的 runId 和 artifactId 分页读取编排成员留下的完整阶段产物。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        runId: { type: 'string', minLength: 1 },
        artifactId: { type: 'string', minLength: 1 },
        offset: { type: 'integer', minimum: 0 },
        maxChars: { type: 'integer', minimum: 1, maximum: 20000 }
      },
      required: ['runId', 'artifactId']
    }
  }
]

/** Stage tool turns belong to their own model calls, not the later ordinary conversation. */
export function withoutOrchestrationStageMessages(messages: ChatMessage[], session: ChatSession): ChatMessage[] {
  const prefixes = (session.orchestrationRuns ?? []).map((run) => `${run.runId}_`)
  return messages.filter((message) => {
    if (message.role !== 'assistant' && message.role !== 'tool') return true
    if (STAGE_MESSAGE_ID.test(message.id)) return false
    return !prefixes.some((prefix) => message.id.startsWith(prefix) && /^(?:plan|setting|prompt|anti-ai|write|polish|review)_(?:assistant|tool|guard|answer)_/.test(message.id.slice(prefix.length)))
  })
}

/** A small automatic handoff lets the model discover the exact artifacts via tools. */
export function orchestrationHandoffPrompt(session: ChatSession): string {
  const runs = (session.orchestrationRuns ?? []).slice(-2).reverse()
  if (!runs.length) return ''
  const promptId = (value: string): string => /^[a-zA-Z0-9_.:-]{1,120}$/.test(value) ? value : '请用 list_orchestration_runs 获取 ID'
  const lines = runs.flatMap((run) => [
    `运行 ${promptId(run.runId)}（${run.status}）`,
    ...run.artifacts.slice(-12).map((artifact) => `- ${promptId(artifact.stageId)} / ${promptId(artifact.id)}（${artifact.status}）`),
    ...(run.artifacts.length > 12 ? [`其余 ${run.artifacts.length - 12} 项请用 list_orchestration_runs 查看。`] : [])
  ])
  return [
    '【本会话编排交接】',
    '以下是同一会话中其他编排成员留下的候选成果。需要依据其完整内容继续工作时，先调用 read_orchestration_artifact；可用 list_orchestration_runs 查看全部保留运行。候选成果不等于已写入项目，当前项目事实仍须用项目资料工具核实。',
    ...lines
  ].join('\n')
}

function result(ok: boolean, value: unknown): Extract<ToolOutcome, { kind: 'result' }> {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return { kind: 'result', ok, text, preview: text.length > 120 ? `${text.slice(0, 120)}…` : text }
}

/** This is bound to the loaded session; callers cannot access another session's files. */
export function executeOrchestrationHistoryTool(session: ChatSession, name: string, argsJson: string): Extract<ToolOutcome, { kind: 'result' }> {
  if (name === 'list_orchestration_runs') {
    return result(true, (session.orchestrationRuns ?? []).map((run) => ({
      runId: run.runId,
      status: run.status,
      updatedAt: run.updatedAt,
      stages: run.stages,
      artifacts: run.artifacts.map(({ id, stageId, agentId, kind, status, createdAt }) => ({ id, stageId, agentId, kind, status, createdAt }))
    })))
  }
  if (name !== 'read_orchestration_artifact') return result(false, `未知会话工具：${name}`)
  let args: Record<string, unknown>
  try { args = JSON.parse(argsJson) as Record<string, unknown> } catch { return result(false, '参数必须是 JSON 对象') }
  if (!args || typeof args !== 'object' || Array.isArray(args) || typeof args.runId !== 'string' || typeof args.artifactId !== 'string') return result(false, '必须提供 runId 和 artifactId')
  const offset = args.offset === undefined ? 0 : args.offset
  const maxChars = args.maxChars === undefined ? 12000 : args.maxChars
  if (!Number.isInteger(offset) || (offset as number) < 0 || !Number.isInteger(maxChars) || (maxChars as number) < 1 || (maxChars as number) > 20000) return result(false, 'offset 或 maxChars 超出范围')
  const run = (session.orchestrationRuns ?? []).find((item) => item.runId === args.runId)
  const artifact = run?.artifacts.find((item) => item.id === args.artifactId)
  if (!run || !artifact) return result(false, '当前会话中找不到该编排产物')
  const content = artifact.text ?? (artifact.payload === undefined ? '' : JSON.stringify(artifact.payload))
  const nextOffset = (offset as number) + (maxChars as number)
  return result(true, {
    runId: run.runId, runStatus: run.status,
    artifactId: artifact.id, stageId: artifact.stageId, agentId: artifact.agentId,
    status: artifact.status, kind: artifact.kind,
    content: content.slice(offset as number, nextOffset), totalChars: content.length,
    nextOffset: nextOffset < content.length ? nextOffset : null,
    complete: nextOffset >= content.length
  })
}
