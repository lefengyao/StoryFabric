import type { AgentEvent, RunActivitySummary } from '../../shared/types'

/** Collects only compact evidence; tool arguments and results stay out of chat history. */
export class RunActivityRecorder {
  private readonly skills = new Map<string, RunActivitySummary['skills'][number]>()
  private readonly rules = new Map<string, RunActivitySummary['rules'][number]>()
  private readonly toolCalls: Array<{ callId: string; name: string; done: boolean; failed: boolean }> = []

  record(event: AgentEvent): void {
    if (event.type === 'skill-activity' && event.activity.status === 'applied') {
      for (const skill of event.activity.skills) {
        const key = `${skill.packageId}\0${skill.skillId}\0${skill.version}`
        const entry = this.skills.get(key) ?? { packageId: skill.packageId, skillId: skill.skillId, version: skill.version, stages: [] }
        const stage = event.activity.stageId ?? '本次回复'
        if (!entry.stages.includes(stage)) entry.stages.push(stage)
        this.skills.set(key, entry)
      }
    } else if (event.type === 'rule-activity' && event.activity.status === 'applied') {
      for (const rule of event.activity.rules) {
        const key = `${rule.source}\0${rule.id}\0${rule.target}\0${rule.key}`
        this.rules.set(key, { id: rule.id, source: rule.source, target: rule.target, key: rule.key })
      }
    } else if (event.type === 'tool-start') {
      const active = this.toolCalls.findLast((call) => call.callId === event.callId && !call.done)
      if (active) active.name = event.name
      else this.toolCalls.push({ callId: event.callId, name: event.name, done: false, failed: false })
    } else if (event.type === 'tool-done') {
      const active = this.toolCalls.findLast((call) => call.callId === event.callId && !call.done)
      if (active) {
        active.done = true
        active.failed = !event.ok
      }
    }
  }

  summary(): RunActivitySummary {
    const tools = new Map<string, RunActivitySummary['tools'][number]>()
    for (const call of this.toolCalls) {
      const entry = tools.get(call.name) ?? { name: call.name, count: 0, failed: 0 }
      entry.count++
      if (call.failed) entry.failed++
      tools.set(call.name, entry)
    }
    return {
      skills: [...this.skills.values()].map((skill) => ({ ...skill, stages: [...skill.stages] })),
      tools: [...tools.values()],
      rules: [...this.rules.values()]
    }
  }
}
