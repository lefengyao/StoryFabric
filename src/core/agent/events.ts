import { validateRunEventEnvelope, type RunEventEnvelope, type RuntimeEvent } from '../../shared/agentRuntime'

export interface RunEventInput extends Omit<RunEventEnvelope, 'schemaVersion' | 'seq' | 'at' | 'event'> {
  event: RuntimeEvent
  at?: number
}

export class RunEventLedger {
  private readonly events: RunEventEnvelope[] = []
  private nextSeq = 1

  constructor(private readonly now: () => number = Date.now, existingEvents: RunEventEnvelope[] = []) {
    for (const event of existingEvents) {
      const validated = validateRunEventEnvelope(event)
      if (this.events.length && validated.seq <= this.events[this.events.length - 1].seq) throw new Error('恢复运行事件 seq 必须递增')
      this.events.push(validated)
      this.nextSeq = Math.max(this.nextSeq, validated.seq + 1)
    }
  }

  append(input: RunEventInput): RunEventEnvelope {
    const event: RunEventEnvelope = {
      schemaVersion: 1,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      runId: input.runId,
      agentId: input.agentId,
      ...(input.parentAgentId ? { parentAgentId: input.parentAgentId } : {}),
      ...(input.stageId ? { stageId: input.stageId } : {}),
      seq: this.nextSeq,
      at: input.at ?? this.now(),
      event: input.event
    }
    const validated = validateRunEventEnvelope(event)
    this.nextSeq += 1
    this.events.push(validated)
    return validated
  }

  list(afterSeq = 0): RunEventEnvelope[] {
    return this.events.filter((event) => event.seq > afterSeq).map((event) => ({ ...event, event: { ...event.event } }))
  }

  get lastSeq(): number { return this.nextSeq - 1 }
}
