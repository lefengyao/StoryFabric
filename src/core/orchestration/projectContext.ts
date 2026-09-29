import type { ChapterMeta, CharacterDoc, OutlineDoc, Relationship, SettingMeta, StoryEvent } from '../../shared/types'
import type { SourceRef } from '../../shared/agentEvidence'
import { contentRevision } from '../workspace/resourceRevision'
import { getChapterBody, listChapters, listCharacters, listEvents, listSettings, loadOutlineDocuments, loadRelationships } from '../workspace/entityStore'
import type { FileStore } from '../storage/fileStore'

export interface ProjectContext {
  workspaceId: string
  goal: string
  targetChapter?: ChapterMeta
  targetChapters: ChapterMeta[]
  targetContent: string
  previousChapters: Array<{ meta: ChapterMeta; content: string }>
  nextChapters: Array<{ meta: ChapterMeta; content: string }>
  chapterOutlines: OutlineDoc[]
  characters: CharacterDoc[]
  settings: SettingMeta[]
  events: StoryEvent[]
  relationships: Relationship[]
  sourceRefs: SourceRef[]
  missing: string[]
  targetAmbiguous: ChapterMeta[]
}

function parseChapterNumber(value: string): number {
  if (/^\d+$/u.test(value)) return Number(value)
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 }
  let total = 0
  let current = 0
  for (const char of value) {
    if (char in digits) current = digits[char]
    else if (char in units) {
      total += (current || 1) * units[char]
      current = 0
    }
  }
  return total + current
}

function targetNumbers(goal: string): number[] {
  const range = goal.match(/第?\s*([0-9]+|[零〇一二三四五六七八九十百千万两]+)\s*(?:到|至|[-~])\s*([0-9]+|[零〇一二三四五六七八九十百千万两]+)\s*章?/u)
  if (range) {
    const start = parseChapterNumber(range[1])
    const end = parseChapterNumber(range[2])
    if (Number.isInteger(start) && Number.isInteger(end) && start > 0 && end >= start && end - start <= 50) return Array.from({ length: end - start + 1 }, (_, index) => start + index)
  }
  const single = goal.match(/第\s*([0-9]+|[零〇一二三四五六七八九十百千万两]+)\s*章/u)
  return single ? [parseChapterNumber(single[1])] : []
}

function sourceRef(workspaceId: string, sourcePath: string, entityId: string, text: string, complete = true): SourceRef {
  return { workspaceId, sourcePath, entityId, revision: contentRevision(text), offset: 0, length: text.length, complete }
}

export async function loadProjectContext(store: FileStore, input: { workspaceId: string; goal: string; radius?: number }): Promise<ProjectContext> {
  const radius = input.radius ?? 2
  const [chapters, outlineDocs, characters, settings, events, relationships] = await Promise.all([
    listChapters(store),
    loadOutlineDocuments(store),
    listCharacters(store),
    listSettings(store),
    listEvents(store),
    loadRelationships(store)
  ])
  const outlines = outlineDocs.map(({ doc }) => doc)
  const sorted = chapters.filter((chapter) => chapter.box !== 'trash').sort((a, b) => a.order - b.order)
  const wanted = targetNumbers(input.goal)
  const matchesByNumber = wanted.map((number) => sorted.filter((chapter) => chapter.order === number || chapter.title.includes(`第${number}章`)))
  const targetAmbiguous = matchesByNumber.flatMap((matches) => matches.length > 1 ? matches : [])
  const targetChapters = wanted.length > 0 && targetAmbiguous.length === 0 && matchesByNumber.every((matches) => matches.length === 1)
    ? matchesByNumber.map((matches) => matches[0])
    : []
  const targetChapter = targetChapters.length === 1 ? targetChapters[0] : undefined
  const targetIndices = targetChapters.map((chapter) => sorted.findIndex((item) => item.id === chapter.id)).filter((index) => index >= 0)
  const firstTargetIndex = targetIndices.length ? Math.min(...targetIndices) : -1
  const lastTargetIndex = targetIndices.length ? Math.max(...targetIndices) : -1
  const missing: string[] = []
  if (targetAmbiguous.length) missing.push(`目标章节存在歧义：${targetAmbiguous.map((chapter) => chapter.title).join('、')}`)
  const missingNumbers = matchesByNumber.flatMap((matches, index) => matches.length === 0 ? [wanted[index]] : [])
  if (missingNumbers.length) missing.push(`未找到${missingNumbers.map((number) => `第${number}章`).join('、')}`)
  if (wanted.length === 0 && /继续|续写|下一章/u.test(input.goal)) missing.push('无法从请求解析目标章节编号')

  const loadWindow = async (items: ChapterMeta[]): Promise<Array<{ meta: ChapterMeta; content: string }>> => Promise.all(items.map(async (meta) => ({ meta, content: await getChapterBody(store, meta.id).catch(() => '') ?? '' })))
  const selectedContents = targetChapters.length ? await loadWindow(targetChapters) : []
  const previousChapters = firstTargetIndex < 0 ? [] : await loadWindow(sorted.slice(Math.max(0, firstTargetIndex - radius), firstTargetIndex))
  const nextChapters = lastTargetIndex < 0 ? [] : await loadWindow(sorted.slice(lastTargetIndex + 1, lastTargetIndex + radius + 1))
  const targetContent = selectedContents.map((item) => `## ${item.meta.title}\n${item.content}`).join('\n\n')
  const sourceRefs: SourceRef[] = []
  for (const item of previousChapters) sourceRefs.push(sourceRef(input.workspaceId, `chapters/${item.meta.id}.md`, item.meta.id, item.content))
  for (const item of selectedContents) sourceRefs.push(sourceRef(input.workspaceId, `chapters/${item.meta.id}.md`, item.meta.id, item.content))
  for (const item of nextChapters) sourceRefs.push(sourceRef(input.workspaceId, `chapters/${item.meta.id}.md`, item.meta.id, item.content))
  const targetIds = new Set(targetChapters.map((chapter) => chapter.id))
  if (outlineDocs.length) sourceRefs.push(...outlineDocs
    .filter(({ doc }) => !targetChapters.length || doc.kind !== 'chapter' || !doc.chapterId || targetIds.has(doc.chapterId))
    .map(({ doc, fileName }) => sourceRef(input.workspaceId, `outline/${fileName}`, doc.id, doc.content)))
  if (characters.length) sourceRefs.push(sourceRef(input.workspaceId, 'characters/index', 'characters', JSON.stringify(characters.map(({ id, name, summary }) => ({ id, name, summary })))))
  if (settings.length) sourceRefs.push(sourceRef(input.workspaceId, 'settings/index', 'settings', JSON.stringify(settings)))
  if (events.length) sourceRefs.push(sourceRef(input.workspaceId, 'events/index', 'events', JSON.stringify(events.map(({ id, title, characterIds }) => ({ id, title, characterIds })))))
  if (relationships.length) sourceRefs.push(sourceRef(input.workspaceId, 'relationships.json', 'relationships', JSON.stringify(relationships)))

  return { ...input, targetChapter, targetChapters, targetContent, previousChapters, nextChapters, chapterOutlines: outlines, characters, settings, events, relationships, sourceRefs, missing, targetAmbiguous }
}

export function summarizeProjectContext(context: ProjectContext): string {
  const target = context.targetChapters.length ? context.targetChapters.map((chapter) => `${chapter.title}（id=${chapter.id}）`).join('、') : '未确定'
  const refs = context.sourceRefs.map((source) => `${source.sourcePath}@${source.revision}`).join('、')
  return [
    `【项目事实输入】目标章节：${target}`,
    context.previousChapters.length ? `前文：${context.previousChapters.map((item) => `${item.meta.title}：${item.content.slice(0, 1200)}`).join('\n')}` : '',
    context.nextChapters.length ? `邻近后文：${context.nextChapters.map((item) => `${item.meta.title}：${item.content.slice(0, 800)}`).join('\n')}` : '',
    context.characters.length ? `人物目录：${context.characters.map((character) => `${character.name}（${character.summary}）`).join('、')}` : '',
    context.missing.length ? `资料缺失：${context.missing.join('；')}` : '',
    refs ? `来源回执：${refs}` : '来源回执：当前未读取到项目资料'
  ].filter(Boolean).join('\n\n')
}
