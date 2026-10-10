import type { RunEventEnvelope } from './agentRuntime'
import { cloneValue, lastItem } from './runtimeCompatibility'

export interface RunReplay {
  replayable: boolean
  events: RunEventEnvelope[]
  snapshotSeq: number
  snapshot?: unknown
}

const DEFAULT_MAX_RUN_EVENT_BYTES = 512 * 1024
const DEFAULT_MAX_RUN_EVENTS = 2000

export class RunEventBuffer {
  private readonly events: RunEventEnvelope[] = []
  private bytes = 0
  private snapshot: unknown

  constructor(private readonly limits: { maxEvents?: number; maxBytes?: number } = {}) {}

  append(event: RunEventEnvelope): void {
    if (this.events.length && event.seq <= this.events[this.events.length - 1].seq) throw new Error('运行事件 seq 必须递增')
    this.events.push(cloneValue(event))
    this.bytes += new TextEncoder().encode(JSON.stringify(event)).byteLength
    while (this.events.length > (this.limits.maxEvents ?? DEFAULT_MAX_RUN_EVENTS) || this.bytes > (this.limits.maxBytes ?? DEFAULT_MAX_RUN_EVENT_BYTES)) {
      const removed = this.events.shift()
      if (removed) this.bytes -= new TextEncoder().encode(JSON.stringify(removed)).byteLength
    }
  }

  setSnapshot(snapshot: unknown): void {
    try {
      const clone = cloneValue(snapshot)
      const bytes = new TextEncoder().encode(JSON.stringify(clone)).byteLength
      this.snapshot = bytes <= (this.limits.maxBytes ?? DEFAULT_MAX_RUN_EVENT_BYTES) ? clone : undefined
    } catch {
      this.snapshot = undefined
    }
  }
  listAfter(afterSeq: number): RunEventEnvelope[] { return this.events.filter((event) => event.seq > afterSeq).map((event) => cloneValue(event)) }

  replay(afterSeq: number): RunReplay {
    const firstSeq = this.events[0]?.seq ?? afterSeq + 1
    const replayable = afterSeq >= firstSeq - 1
    return { replayable, events: replayable ? this.listAfter(afterSeq) : [], snapshotSeq: lastItem(this.events)?.seq ?? 0, ...(this.snapshot === undefined ? {} : { snapshot: cloneValue(this.snapshot) }) }
  }
}
