import type { AgentEventEnvelope } from '../shared/api'

type StreamEvent = Extract<AgentEventEnvelope['event'], { type: 'text-delta' | 'tool-args-delta' | 'tool-preview' }>
interface BufferedEvent { envelope: AgentEventEnvelope; workspaceId?: string }

const FRAME_MS = 16
const MAX_PENDING_DELTA_CHARS = 16_000

function streamKey(envelope: AgentEventEnvelope, workspaceId?: string): string | null {
  const event = envelope.event
  const prefix = `${workspaceId ?? ''}\u0000${envelope.sessionId}\u0000${envelope.runId ?? ''}\u0000${event.type}\u0000`
  if (event.type === 'text-delta') return prefix + event.messageId
  if (event.type === 'tool-args-delta' || event.type === 'tool-preview') return prefix + event.callId
  return null
}

/** Keeps model token traffic below the renderer's frame rate without changing tool results. */
export class AgentEventBridge {
  private readonly pending: BufferedEvent[] = []
  private readonly indices = new Map<string, number>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private pendingDeltaChars = 0

  constructor(private readonly deliver: (envelope: AgentEventEnvelope, workspaceId?: string) => void) {}

  push(envelope: AgentEventEnvelope, workspaceId?: string): void {
    const key = streamKey(envelope, workspaceId)
    if (!key) {
      this.flush()
      this.deliver(envelope, workspaceId)
      return
    }
    const index = this.indices.get(key)
    if (index === undefined) {
      this.indices.set(key, this.pending.length)
      this.pending.push({ envelope, workspaceId })
    } else {
      const previous = this.pending[index].envelope.event as StreamEvent
      const event = envelope.event as StreamEvent
      const merged: StreamEvent = event.type === 'tool-preview'
        ? event
        : event.type === 'text-delta' && previous.type === 'text-delta'
          ? { ...previous, delta: previous.delta + event.delta }
          : event.type === 'tool-args-delta' && previous.type === 'tool-args-delta'
            ? { ...previous, delta: previous.delta + event.delta }
            : event
      this.pending[index].envelope = { ...envelope, event: merged }
    }
    const streamEvent = envelope.event as StreamEvent
    if (streamEvent.type !== 'tool-preview') this.pendingDeltaChars += streamEvent.delta.length
    if (this.pendingDeltaChars >= MAX_PENDING_DELTA_CHARS) this.flush()
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), FRAME_MS)
  }

  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    const pending = this.pending.splice(0)
    this.indices.clear()
    this.pendingDeltaChars = 0
    for (const item of pending) this.deliver(item.envelope, item.workspaceId)
  }
}
