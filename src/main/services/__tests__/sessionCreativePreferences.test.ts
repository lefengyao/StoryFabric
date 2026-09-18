import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionStore } from '../sessionStore'

let root: string

beforeEach(async () => {
  root = join(tmpdir(), `sf-creative-session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
  await fs.mkdir(root, { recursive: true })
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('SessionStore creative preferences', () => {
  it('persists a creativePreferences patch and returns it from loadSession', async () => {
    const store = new SessionStore(root)
    const session = await store.create()
    await store.save(session)

    const creativePreferences = {
      mode: 'orchestration' as const,
      orchestrationEnabled: true,
      subagentsEnabled: false,
      intensity: 'standard' as const,
      selectedSkillIds: [],
      selectedRuleSetIds: [],
      orchestration: {
        mode: 'single' as const,
        enabled: true,
        subagentsEnabled: false,
        enabledStageIds: ['write'],
        modelByStage: {},
        maxCalls: 24,
        maxEstimatedTokens: 300000
      }
    }

    expect(await store.updateMeta(session.id, { creativePreferences })).toBe(true)
    expect((await store.load(session.id))?.creativePreferences).toEqual(creativePreferences)
  })

  it('rejects malformed creative preferences instead of persisting them', async () => {
    const store = new SessionStore(root)
    const session = await store.create()
    await store.save(session)
    await expect(store.updateMeta(session.id, { creativePreferences: { mode: 'invalid' } as never })).rejects.toThrow(/creative\.mode/)
    await expect(store.save({ ...session, creativePreferences: { mode: 'invalid' } as never })).rejects.toThrow(/creative\.mode/)
  })
})
