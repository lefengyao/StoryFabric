import { validateRunEventEnvelope, type RunEventEnvelope, type RuntimeEvent } from '../../shared/agentRuntime'

export interface RunEventInput extends Omit<RunEventEnvelope, 'schemaVersion' | 'seq' | 'at' | 'event'> {
  event: RuntimeEvent
  at?: number
}

export class RunEventLedger {
  private readonly events: RunEventEnvelope[] = []
  private nextSeq = 1

  constructor(private readonly now: () => number = Date.now) {}

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
