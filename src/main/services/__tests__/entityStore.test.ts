import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CharacterDoc } from '../../../shared/types'
import {
  countWords,
  deleteCharacter,
  findCharacter,
  getChapterBody,
  listCharacters,
  listChapters,
  listEvents,
  listOutline,
  loadRelationships,
  saveChapter,
  saveCharacter,
  saveEvent,
  saveOutlineDoc,
  saveRelationships,
  searchProject,
  serializeRelationships
} from '../entityStore'

let root: string

beforeEach(async () => {
  root = join(tmpdir(), `sf-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
  await fs.mkdir(root, { recursive: true })
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('character store', () => {
  it('创建、读取、按名称查找人物', async () => {
    const c = await saveCharacter(root, { name: '林晚', role: '主角', tags: ['法师'], summary: '星图修复师', content: '# 林晚\n冷静、执着。' })
    expect(c.id).toMatch(/^char_/)

    const all = await listCharacters(root)
    expect(all).toHaveLength(1)
    expect(all[0].name).toBe('林晚')
    expect(all[0].content).toContain('冷静')

    const byName = await findCharacter(root, { name: '林晚' })
    expect(byName?.id).toBe(c.id)
    const byAlias = await saveCharacter(root, { name: '沈屹', aliases: ['老师'] })
    expect((await findCharacter(root, { name: '老师' }))?.id).toBe(byAlias.id)
  })

  it('更新人物时重命名文件并保留 id', async () => {
    const c = await saveCharacter(root, { name: '旧名' })
    await saveCharacter(root, { id: c.id, name: '新名', summary: '更新过' })

    const all = await listCharacters(root)
    expect(all).toHaveLength(1)
    expect(all[0].name).toBe('新名')
    expect(all[0].summary).toBe('更新过')

    // 磁盘上旧文件已删除
    const files = await fs.readdir(join(root, 'characters'))
    expect(files).toHaveLength(1)
    expect(files[0]).toContain('新名')
  })

  it('部分字段更新不丢失既有内容', async () => {
    const c = await saveCharacter(root, { name: '阿澈', content: '原始设定正文' })
    await saveCharacter(root, { id: c.id, role: '配角' })
    const [doc] = await listCharacters(root)
    expect(doc.content.trim()).toBe('原始设定正文')
    expect(doc.role).toBe('配角')
  })

  it('删除人物并级联清理关系', async () => {
    const a = await saveCharacter(root, { name: 'A' })
    const b = await saveCharacter(root, { name: 'B' })
    await saveRelationships(root, [{ id: 'r1', fromId: a.id, toId: b.id, type: '朋友', label: '', description: '', directed: false }])
    await deleteCharacter(root, a.id)
    expect(await listCharacters(root)).toHaveLength(1)
    expect(await loadRelationships(root)).toHaveLength(0)
  })
})

describe('relationships', () => {
  it('保存并读回关系边列表', async () => {
    const rels = [
      { id: 'r1', fromId: 'char_a', toId: 'char_b', type: '师徒', label: '授业', description: '十年前拜师', directed: true },
      { id: 'r2', fromId: 'char_b', toId: 'char_c', type: '敌对', label: '', description: '', directed: false }
    ]
    await saveRelationships(root, rels)
    const loaded = await loadRelationships(root)
    expect(loaded).toHaveLength(2)
    expect(loaded[0].type).toBe('师徒')
    expect(serializeRelationships(loaded, (id) => `<${id}>`)).toContain('<char_a> → <char_b> 【师徒】 授业 — 十年前拜师')
  })
})

describe('outline/events/chapters', () => {
  it('大纲文档排序与保存', async () => {
    await saveOutlineDoc(root, { title: '第二卷', order: 2 })
    await saveOutlineDoc(root, { title: '第一卷', order: 1 })
    const docs = await listOutline(root)
    expect(docs.map((d) => d.title)).toEqual(['第一卷', '第二卷'])
  })

  it('事件因果链持久化', async () => {
    const e1 = await saveEvent(root, { title: '夺旗之夜', storyTime: '第三年·春', characterIds: ['char_x'] })
    const e2 = await saveEvent(root, { title: '南下', prevIds: [e1.id], nextIds: [] })
    await saveEvent(root, { id: e1.id, nextIds: [e2.id] })
    const events = await listEvents(root)
    expect(events).toHaveLength(2)
    expect(events.find((e) => e.id === e1.id)?.nextIds).toEqual([e2.id])
  })

  it('章节保存统计字数并可读回正文', async () => {
    const ch = await saveChapter(root, { title: '第一章 启程', volume: '第一卷', order: 1, status: 'draft', content: '夜色如墨。\n他背起行囊。' })
    expect(ch.wordCount).toBe(countWords('夜色如墨。他背起行囊。'))
    const body = await getChapterBody(root, ch.id)
    expect(body).toContain('夜色如墨')
    const metas = await listChapters(root)
    expect(metas[0].title).toBe('第一章 启程')
    expect(metas[0]).not.toHaveProperty('content')
  })
})

describe('searchProject', () => {
  it('跨实体检索并返回片段', async () => {
    await saveCharacter(root, { name: '林晚', content: '她随身带着一枚青铜罗盘。' })
    await saveEvent(root, { title: '罗盘失窃', content: '那枚青铜罗盘在夜里不见了。' })
    await saveChapter(root, { title: '第二章', content: '提到青铜罗盘的来历。' })

    const hits = await searchProject(root, '青铜罗盘')
    expect(hits.length).toBeGreaterThanOrEqual(3)
    const kinds = hits.map((h) => h.kind)
    expect(kinds).toContain('character')
    expect(kinds).toContain('event')
    expect(hits.every((h) => h.snippet.includes('青铜罗盘'))).toBe(true)
  })
})

describe('serialization', () => {
  it('人物序列化包含 frontmatter 与正文', async () => {
    const doc: CharacterDoc = {
      id: 'char_s',
      name: '测试',
      aliases: [],
      role: '',
      gender: '',
      age: '',
      tags: [],
      summary: '',
      content: '正文内容'
    }
    await saveCharacter(root, doc)
    const raw = await fs.readFile(join(root, 'characters', '测试.md'), 'utf-8')
    expect(raw.startsWith('---')).toBe(true)
    expect(raw).toContain('id: char_s')
    expect(raw.trimEnd().endsWith('正文内容')).toBe(true)
  })
})
