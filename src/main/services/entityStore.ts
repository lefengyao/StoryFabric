/**
 * Electron 主进程实体服务适配层。
 *
 * 所有序列化和目录规则由共享核心维护；这里仅把旧的 root 路径签名
 * 转换为 NodeFileStore，确保 Windows 与 Android 使用同一份实现。
 */
import { NodeFileStore } from '../../core/storage/nodeFileStore'
import {
  countWords as coreCountWords,
  deleteChapter as coreDeleteChapter,
  deleteCharacter as coreDeleteCharacter,
  deleteEvent as coreDeleteEvent,
  deleteOutlineDoc as coreDeleteOutlineDoc,
  findCharacter as coreFindCharacter,
  genId,
  getChapterBody as coreGetChapterBody,
  listCharacters as coreListCharacters,
  listChapters as coreListChapters,
  listEvents as coreListEvents,
  listOutline as coreListOutline,
  listNotes as coreListNotes,
  listSettings as coreListSettings,
  getNote as coreGetNote,
  getSetting as coreGetSetting,
  loadRelationships as coreLoadRelationships,
  saveChapter as coreSaveChapter,
  saveCharacter as coreSaveCharacter,
  saveEvent as coreSaveEvent,
  saveOutlineDoc as coreSaveOutlineDoc,
  saveNote as coreSaveNote,
  saveSetting as coreSaveSetting,
  saveRelationships as coreSaveRelationships,
  searchProject as coreSearchProject,
  serializeChapter,
  serializeCharacter,
  serializeEvent,
  serializeOutlineDoc,
  serializeRelationships,
  deleteNote as coreDeleteNote,
  deleteSetting as coreDeleteSetting,
  sanitizeFileName
} from '../../core/workspace/entityStore'
import type {
  ChapterDoc,
  ChapterMeta,
  CharacterDoc,
  OutlineDoc,
  Relationship,
  SearchHit,
  StoryEvent,
  NoteDoc,
  NoteMeta,
  SettingDoc,
  SettingMeta
} from '../../shared/types'

function storeOf(root: string): NodeFileStore {
  return new NodeFileStore(root)
}

async function usesLegacyFlatLayout(root: string): Promise<boolean> {
  return !(await storeOf(root).exists('storyfabric.json'))
}

async function flattenLegacyFile(store: NodeFileStore, nestedDir: string, flatDir: string, id: string): Promise<void> {
  for (const file of await store.listFiles(nestedDir, '.md')) {
    const nested = `${nestedDir}/${file}`
    const raw = await store.readText(nested)
    if (raw?.includes(`id: ${id}`)) {
      await store.move(nested, `${flatDir}/${file}`)
      return
    }
  }
}

async function removeEmptyDir(store: NodeFileStore, dir: string): Promise<void> {
  if ((await store.listFiles(dir)).length === 0 && (await store.listDirs(dir)).length === 0) await store.remove(dir)
}

export { genId, sanitizeFileName, serializeCharacter, serializeOutlineDoc, serializeEvent, serializeChapter, serializeRelationships }

export function countWords(text: string): number {
  return coreCountWords(text)
}

export function listCharacters(root: string): Promise<CharacterDoc[]> {
  return coreListCharacters(storeOf(root))
}

export function findCharacter(root: string, ref: { id?: string; name?: string }): Promise<CharacterDoc | null> {
  return coreFindCharacter(storeOf(root), ref)
}

export async function saveCharacter(root: string, input: Partial<CharacterDoc> & { id?: string }): Promise<CharacterDoc> {
  const store = storeOf(root)
  const legacy = await usesLegacyFlatLayout(root)
  const saved = await coreSaveCharacter(store, input)
  if (legacy) {
    const tierDir = `characters/${saved.tier === 'primary' ? 'primary' : 'secondary'}`
    await flattenLegacyFile(store, tierDir, 'characters', saved.id)
    await removeEmptyDir(store, tierDir)
  }
  return saved
}

export function deleteCharacter(root: string, id: string): Promise<void> {
  return coreDeleteCharacter(storeOf(root), id)
}

export function loadRelationships(root: string): Promise<Relationship[]> {
  return coreLoadRelationships(storeOf(root))
}

export function saveRelationships(root: string, list: Relationship[]): Promise<void> {
  return coreSaveRelationships(storeOf(root), list)
}

export function listOutline(root: string): Promise<OutlineDoc[]> {
  return coreListOutline(storeOf(root))
}

export async function saveOutlineDoc(root: string, input: Partial<OutlineDoc> & { id?: string }): Promise<OutlineDoc> {
  const store = storeOf(root)
  const legacy = await usesLegacyFlatLayout(root)
  const saved = await coreSaveOutlineDoc(store, input)
  if (legacy) await flattenLegacyFile(store, saved.kind === 'chapter' ? `outline/chapters/${saved.chapterId}` : 'outline/total', 'outline', saved.id)
  return saved
}

export function deleteOutlineDoc(root: string, id: string): Promise<void> {
  return coreDeleteOutlineDoc(storeOf(root), id)
}

export function listEvents(root: string): Promise<StoryEvent[]> {
  return coreListEvents(storeOf(root))
}

export function saveEvent(root: string, input: Partial<StoryEvent> & { id?: string }): Promise<StoryEvent> {
  return coreSaveEvent(storeOf(root), input)
}

export function deleteEvent(root: string, id: string): Promise<void> {
  return coreDeleteEvent(storeOf(root), id)
}

export function listChapters(root: string): Promise<ChapterMeta[]> {
  return coreListChapters(storeOf(root))
}

export function getChapterBody(root: string, id: string): Promise<string | null> {
  return coreGetChapterBody(storeOf(root), id)
}

export async function saveChapter(root: string, input: Partial<ChapterDoc> & { id?: string }): Promise<ChapterDoc> {
  const store = storeOf(root)
  const legacy = await usesLegacyFlatLayout(root)
  const saved = await coreSaveChapter(store, input)
  if (legacy) await flattenLegacyFile(store, saved.box === 'draft' ? 'chapters/draft' : `chapters/main/${saved.volumeId ?? 'vol_default'}`, 'chapters', saved.id)
  return saved
}

export function deleteChapter(root: string, id: string): Promise<void> {
  return coreDeleteChapter(storeOf(root), id)
}

export function listSettings(root: string): Promise<SettingMeta[]> { return coreListSettings(storeOf(root)) }
export function getSetting(root: string, id: string): Promise<SettingDoc | null> { return coreGetSetting(storeOf(root), id) }
export function saveSetting(root: string, input: Partial<SettingDoc> & { id?: string }): Promise<SettingDoc> { return coreSaveSetting(storeOf(root), input) }
export function deleteSetting(root: string, id: string): Promise<void> { return coreDeleteSetting(storeOf(root), id) }
export function listNotes(root: string): Promise<NoteMeta[]> { return coreListNotes(storeOf(root)) }
export function getNote(root: string, id: string): Promise<NoteDoc | null> { return coreGetNote(storeOf(root), id) }
export function saveNote(root: string, input: Partial<NoteDoc> & { id?: string }): Promise<NoteDoc> { return coreSaveNote(storeOf(root), input) }
export function deleteNote(root: string, id: string): Promise<void> { return coreDeleteNote(storeOf(root), id) }

export function searchProject(root: string, query: string): Promise<SearchHit[]> {
  return coreSearchProject(storeOf(root), query)
}
