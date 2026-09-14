import type { RunEventEnvelope } from '../../../../shared/agentRuntime'

export function RunTimeline({ events }: { events: RunEventEnvelope[] }): React.ReactElement {
  return <ol className="space-y-1 text-xs text-muted">{events.map((event) => <li key={`${event.runId}:${event.seq}`} className="flex gap-2"><span className="font-mono text-faint">{event.seq}</span><span>{event.stageId ?? event.agentId} · {event.event.type}</span></li>)}</ol>
}
