import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { GlobalSkillLibrary } from '../globalSkillLibrary'
import { executeSkillTool } from '../skillTools'
import { SkillResolver } from '../skillResolver'
import type { ContentPackage } from '../types'

const pkg: ContentPackage = {
  manifest: {
    schemaVersion: 1,
    id: 'dialogue-pack',
    version: '1.0.0',
    name: '对白工具箱',
    description: '自然对白与人物语气',
    author: 'test',
    license: 'MIT',
    minAppVersion: '0.1.0',
    platforms: ['windows', 'web', 'android'],
    skills: [{ id: 'dialogue', path: 'skills/dialogue/SKILL.md' }],
    ruleSets: []
  },
  files: [{ path: 'skills/dialogue/SKILL.md', content: '---\nid: dialogue\nname: 自然对白\nstages: [write, polish]\n---\n保持人物语气自然，避免模板化对白。' }]
}

describe('global skill resolver', () => {
  it('uses a fixed enabled snapshot and emits visible lifecycle events', async () => {
    const library = new GlobalSkillLibrary(new MemoryFileStore())
    await library.install(pkg)
    const resolver = new SkillResolver(library)
    const snapshot = await resolver.createSnapshot()
    const events: string[] = []
    const result = await resolver.resolve({ runId: 'run-1', stageId: 'write', agentId: 'write', query: '继续对白', selectedSkillIds: ['dialogue'], snapshot, emit: (event) => events.push(event.status) })
    expect(result.skills).toHaveLength(1)
    expect(result.prompt).toContain('避免模板化对白')
    expect(events).toEqual(['checked', 'matched', 'loaded', 'applied'])
    await library.setEnabled(pkg.manifest.id, pkg.manifest.version, false)
    expect((await resolver.listSkills(snapshot))).toHaveLength(1)
    const read = await executeSkillTool(library, 'read_skill', JSON.stringify({ skillId: 'dialogue' }), snapshot)
    expect(read.readSkill).toEqual(expect.objectContaining({ packageId: 'dialogue-pack', skillId: 'dialogue', version: '1.0.0' }))
  })

  it('returns none for a stage-incompatible automatic match and does not install proposals', async () => {
    const library = new GlobalSkillLibrary(new MemoryFileStore())
    await library.install(pkg)
    const snapshot = await new SkillResolver(library).createSnapshot()
    const events: string[] = []
    const result = await new SkillResolver(library).resolve({ runId: 'run-2', stageId: 'review', agentId: 'review', query: '对白', snapshot, emit: (event) => events.push(event.status) })
    expect(result.skills).toHaveLength(0)
    expect(events).toEqual(['checked', 'none'])
    const proposal = await executeSkillTool(library, 'propose_skill_package', JSON.stringify({ package: pkg, reason: '补充对白校对能力' }), snapshot)
    expect(proposal.ok).toBe(true)
    expect(proposal.text).toContain('requiresConfirmation')
    expect(await library.list()).toHaveLength(1)
  })

  it('automatically applies a skill that is valid for the current stage when the request wording is generic', async () => {
    const library = new GlobalSkillLibrary(new MemoryFileStore())
    await library.install(pkg)
    const snapshot = await new SkillResolver(library).createSnapshot()

    const result = await new SkillResolver(library).resolve({
      runId: 'run-3',
      stageId: 'write',
      agentId: 'write',
      query: '优化第二十三到第二十四章',
      snapshot,
      emit: () => undefined
    })

    expect(result.skills.map((skill) => skill.ref.skillId)).toEqual(['dialogue'])
  })

  it('keeps the preflight stage narrow so a normal writing request can load enabled skills', async () => {
    const library = new GlobalSkillLibrary(new MemoryFileStore())
    await library.install(pkg)
    const snapshot = await new SkillResolver(library).createSnapshot()
    const result = await new SkillResolver(library).resolve({
      runId: 'run-4',
      stageId: 'write',
      agentId: 'basic',
      query: '写第一章',
      snapshot
    })

    expect(result.skills.map((skill) => skill.ref.skillId)).toEqual(['dialogue'])
    expect(result.events.map((event) => event.status)).toEqual(['checked', 'matched', 'loaded', 'applied'])
  })

  it('honors an explicitly selected skill even when it is outside the inferred stage', async () => {
    const library = new GlobalSkillLibrary(new MemoryFileStore())
    await library.install(pkg)
    const snapshot = await new SkillResolver(library).createSnapshot()
    const result = await new SkillResolver(library).resolve({
      runId: 'run-5', stageId: 'review', agentId: 'basic', query: '检查内容',
      selectedSkillIds: ['dialogue'], snapshot
    })
    expect(result.skills.map((skill) => skill.ref.skillId)).toEqual(['dialogue'])
    expect(result.skills[0].reason).toBe('用户显式选择')
  })
})
