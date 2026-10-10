import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { readWritingTools, writeWritingTools } from '../writingTools'
import { normalizeWritingTools, suggestedWritingWords, visibleWritingWords } from '../../../shared/writingTools'
import { exportWorkspaceArchive, importWorkspaceArchive } from '../archive'

describe('workspace writing tools', () => {
  it('loads safe defaults for missing or malformed metadata', async () => {
    const store = new MemoryFileStore()
    expect(await readWritingTools(store)).toEqual({ customWords: [], hiddenWords: [] })
    await store.writeText('.storyfabric/writing-tools.json', '{bad')
    expect(await readWritingTools(store)).toEqual({ customWords: [], hiddenWords: [] })
  })
  it('persists custom words and exclusions in this workspace without modifying chapters', async () => {
    const store = new MemoryFileStore()
    await store.writeText('chapters/chapter.md', '原文')
    await writeWritingTools(store, { customWords: [' 林舟 ', '林舟', '灵剑'], hiddenWords: ['世界观'] })
    expect(await readWritingTools(store)).toEqual({ customWords: ['林舟', '灵剑'], hiddenWords: ['世界观'] })
    expect(await store.readText('chapters/chapter.md')).toBe('原文')
    expect(await readWritingTools(new MemoryFileStore())).toEqual({ customWords: [], hiddenWords: [] })
  })
  it('normalizes untrusted values, deduplicates and bounds the term list', () => {
    expect(normalizeWritingTools({ customWords: ['甲', 123, '', '乙\n丙', '甲'], hiddenWords: null })).toEqual({ customWords: ['甲'], hiddenWords: [] })
    expect(normalizeWritingTools({ customWords: Array.from({ length: 1000 }, (_, i) => `词${i}`) }).customWords.length).toBe(200)
  })
  it('carries the custom word list through a portable project backup and restore', async () => {
    const source = new MemoryFileStore()
    await source.writeText('storyfabric.json', JSON.stringify({ app: 'storyfabric', version: 5, name: '词表项目' }))
    await writeWritingTools(source, { customWords: ['山门'], hiddenWords: ['角色'] })
    const archive = await exportWorkspaceArchive(source, '词表项目')
    const target = new MemoryFileStore()
    await importWorkspaceArchive(target, archive.bytes)
    expect(await readWritingTools(target)).toEqual({ customWords: ['山门'], hiddenWords: ['角色'] })
  })
  it('suggests character names, aliases and setting titles, keeping custom words first', () => {
    const words = suggestedWritingWords({ characters: [{ name: '林舟', aliases: ['小舟', '林舟'] }], settings: [{ title: '灵剑' }] })
    expect(words).toEqual(['林舟', '小舟', '灵剑'])
    expect(visibleWritingWords(words, { customWords: ['灵剑', '山门'], hiddenWords: ['小舟'] })).toEqual(['灵剑', '山门', '林舟'])
  })
})
