import type { RunEventEnvelope } from './agentRuntime'

export interface RunReplay {
  replayable: boolean
  events: RunEventEnvelope[]
  snapshotSeq: number
  snapshot?: unknown
}

export class RunEventBuffer {
  private readonly events: RunEventEnvelope[] = []
  private bytes = 0
  private snapshot: unknown

  constructor(private readonly limits: { maxEvents?: number; maxBytes?: number } = {}) {}

  append(event: RunEventEnvelope): void {
    if (this.events.length && event.seq <= this.events[this.events.length - 1].seq) throw new Error('运行事件 seq 必须递增')
    this.events.push(structuredClone(event))
    this.bytes += new TextEncoder().encode(JSON.stringify(event)).byteLength
    while (this.events.length > (this.limits.maxEvents ?? 2000) || this.bytes > (this.limits.maxBytes ?? 2 * 1024 * 1024)) {
      const removed = this.events.shift()
      if (removed) this.bytes -= new TextEncoder().encode(JSON.stringify(removed)).byteLength
    }
  }

  setSnapshot(snapshot: unknown): void { this.snapshot = structuredClone(snapshot) }
  listAfter(afterSeq: number): RunEventEnvelope[] { return this.events.filter((event) => event.seq > afterSeq).map((event) => structuredClone(event)) }

  replay(afterSeq: number): RunReplay {
    const firstSeq = this.events[0]?.seq ?? afterSeq + 1
    const replayable = afterSeq >= firstSeq - 1
    return { replayable, events: replayable ? this.listAfter(afterSeq) : [], snapshotSeq: this.events.at(-1)?.seq ?? 0, ...(this.snapshot === undefined ? {} : { snapshot: structuredClone(this.snapshot) }) }
  }
}
