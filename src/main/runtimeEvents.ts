import { adaptLegacyAgentEvent, legacyEventIdentity, type RunEventEnvelope } from '../shared/agentRuntime'
import type { AgentEvent } from '../shared/types'
import { RunEventBuffer, type RunReplay } from '../shared/runEvents'

export class MainRuntimeEvents {
  private readonly buffers = new Map<string, RunEventBuffer>()
  private readonly sequences = new Map<string, number>()
  private readonly touched = new Map<string, number>()
  private readonly maxRuns: number

  constructor(options: { maxRuns?: number } = {}) {
    // Keep completed run snapshots bounded for the lifetime of the process.
    this.maxRuns = Math.max(1, options.maxRuns ?? 32)
  }

  private ensureCapacity(key: string): void {
    if (this.buffers.has(key)) return
    while (this.buffers.size >= this.maxRuns) {
      const oldest = [...this.touched.entries()].sort((a, b) => a[1] - b[1])[0]?.[0]
      if (!oldest) break
      this.buffers.delete(oldest)
      this.sequences.delete(oldest)
      this.touched.delete(oldest)
    }
  }

  append(workspaceId: string, sessionId: string, runId: string, event: AgentEvent): RunEventEnvelope {
    const key = `${workspaceId}\u0000${runId}`
    this.ensureCapacity(key)
    const seq = (this.sequences.get(key) ?? 0) + 1
    this.sequences.set(key, seq)
    this.touched.set(key, Date.now())
    const envelope = adaptLegacyAgentEvent({ workspaceId, sessionId, runId, ...legacyEventIdentity(event), seq, event })
    const buffer = this.buffers.get(key) ?? new RunEventBuffer()
    buffer.append(envelope)
    buffer.setSnapshot({ workspaceId, sessionId, runId, lastSeq: seq, event: envelope.event })
    this.buffers.set(key, buffer)
    return envelope
  }

  replay(workspaceId: string, runId: string, afterSeq = 0): RunReplay {
    return (this.buffers.get(`${workspaceId}\u0000${runId}`) ?? new RunEventBuffer()).replay(afterSeq)
  }
}
