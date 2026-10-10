import type { FileStore } from '../storage/fileStore'
import { normalizeWritingTools, type WritingToolsPreferences } from '../../shared/writingTools'

const PATH = '.storyfabric/writing-tools.json'

export async function readWritingTools(store: FileStore): Promise<WritingToolsPreferences> {
  const raw = await store.readText(PATH)
  try { return normalizeWritingTools(raw ? JSON.parse(raw) : null) } catch { return normalizeWritingTools(null) }
}

export async function writeWritingTools(store: FileStore, preferences: WritingToolsPreferences): Promise<void> {
  await store.ensureDir('.storyfabric')
  await store.writeText(PATH, JSON.stringify(normalizeWritingTools(preferences), null, 2))
}
