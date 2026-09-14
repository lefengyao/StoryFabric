import { expect, it } from 'vitest'
import { RunEventBuffer } from '../runEvents'

it('replays only events after the cursor and returns a snapshot when the replay window is exceeded', () => {
  const buffer = new RunEventBuffer({ maxEvents: 2, maxBytes: 10000 })
  buffer.append({ schemaVersion: 1, workspaceId: 'w', sessionId: 's', runId: 'r', agentId: 'a', seq: 1, at: 1, event: { type: 'run-start' } })
  buffer.append({ schemaVersion: 1, workspaceId: 'w', sessionId: 's', runId: 'r', agentId: 'a', seq: 2, at: 2, event: { type: 'text-delta', messageId: 'm', delta: 'a' } })
  buffer.append({ schemaVersion: 1, workspaceId: 'w', sessionId: 's', runId: 'r', agentId: 'a', seq: 3, at: 3, event: { type: 'run-done' } })

  expect(buffer.listAfter(2).map((event) => event.seq)).toEqual([3])
  expect(buffer.replay(0)).toMatchObject({ replayable: false, snapshotSeq: 3 })
  expect(buffer.replay(2)).toMatchObject({ replayable: true, events: [{ seq: 3 }] })
})
