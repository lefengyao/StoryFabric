import { expect, it } from 'vitest'
import { parseSkillMarkdown, validateContentPackage } from '../packageValidator'

it('validates a declarative package and parses its skill front matter', () => {
  const skill = parseSkillMarkdown('---\nid: dialogue\nname: 自然对白\nstages: [anti-ai, polish]\n---\n保留人物意图。')
  expect(skill).toMatchObject({ id: 'dialogue', name: '自然对白', stages: ['anti-ai', 'polish'], body: '保留人物意图。' })
  expect(validateContentPackage({
    manifest: { schemaVersion: 1, id: 'storyfabric.dialogue', version: '1.0.0', name: '自然对白', description: 'd', author: 'StoryFabric', license: 'bundled', minAppVersion: '0.1.5', platforms: ['windows', 'web', 'android'], skills: [{ id: 'dialogue', path: 'skills/dialogue/SKILL.md' }], ruleSets: [] },
    files: [{ path: 'skills/dialogue/SKILL.md', content: '---\nid: dialogue\nname: 自然对白\nstages: [polish]\n---\n保留人物意图。' }]
  }).manifest.id).toBe('storyfabric.dialogue')
})

it('rejects executable entries, path traversal, oversized content and unknown schema', () => {
  const base = { schemaVersion: 1, id: 'p', version: '1.0.0', name: 'p', description: 'd', author: 'a', license: 'l', minAppVersion: '0.1.5', platforms: ['web'], skills: [], ruleSets: [] }
  expect(() => validateContentPackage({ manifest: base, files: [{ path: '../run.sh', content: 'x' }] })).toThrow(/路径|越界/)
  expect(() => validateContentPackage({ manifest: base, files: [{ path: 'run.js', content: 'x' }] })).toThrow(/执行|脚本/)
  expect(() => validateContentPackage({ manifest: { ...base, schemaVersion: 99 }, files: [] })).toThrow(/schema|版本/)
})
