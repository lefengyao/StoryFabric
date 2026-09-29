import type { CharacterDoc, ChapterDoc, NoteDoc, OutlineDoc, SettingDoc, StoryEvent } from '../../shared/types'
import type { FileStore } from '../storage/fileStore'
import { contentRevision, resourceRevision } from '../workspace/resourceRevision'
import { extractTextFromBytes, supportsTextExtraction, TextExtractionError } from '../inspiration/textExtractors'
import { PROJECT_DOC_MAX_BYTES } from '../workspace/projectDocs'
import {
  loadChapterDocuments,
  loadCharacterDocuments,
  loadEventDocuments,
  loadNoteDocuments,
  loadOutlineDocuments,
  loadRelationshipDocuments,
  loadSettingDocuments,
  serializeChapter,
  serializeCharacter,
  serializeEvent,
  serializeNote,
  serializeOutlineDoc,
  serializeRelationships
} from '../workspace/entityStore'

export type CorpusKind = 'character' | 'relationship' | 'outline' | 'event' | 'chapter' | 'setting' | 'note' | 'projectDoc'

export interface CorpusField {
  name: string
  text: string
}

export interface CorpusEntry {
  kind: CorpusKind
  id: string
  title: string
  sourcePath: string
  sourceRevision: string
  writeRevision: string
  fields: CorpusField[]
}

export interface CorpusFailure {
  sourcePath: string
  code: string
}

export interface ProjectCorpus {
  projectRevision: string
  entries: CorpusEntry[]
  scannedSources: number
  failedSources: CorpusFailure[]
}

export interface CorpusOptions {
  kinds?: CorpusKind[]
  includeProjectDocs?: boolean
}

const DEFAULT_KINDS: CorpusKind[] = ['character', 'relationship', 'outline', 'event', 'chapter', 'setting', 'note']

async function sourceRevision(store: FileStore, sourcePath: string, failures: CorpusFailure[]): Promise<string | null> {
  const result = await store.readTextStrict(sourcePath)
  if (!result.ok) {
    failures.push({ sourcePath, code: result.code })
    return null
  }
  return contentRevision(result.text)
}

async function listProjectDocPaths(store: FileStore, dir = 'docs'): Promise<string[]> {
  const files = (await store.listFiles(dir)).map((name) => `${dir}/${name}`).filter((path) => supportsTextExtraction(path))
  for (const child of await store.listDirs(dir)) files.push(...await listProjectDocPaths(store, `${dir}/${child}`))
  return files.sort()
}

function entry(kind: CorpusKind, id: string, title: string, sourcePath: string, revision: string | null, writeRevision: string, fields: CorpusField[]): CorpusEntry | null {
  return revision ? { kind, id, title, sourcePath, sourceRevision: revision, writeRevision, fields: fields.filter((field) => field.text.length > 0) } : null
}

export async function loadProjectCorpus(store: FileStore, options: CorpusOptions = {}): Promise<ProjectCorpus> {
  const selected = new Set(options.kinds?.length ? options.kinds : DEFAULT_KINDS)
  if (options.includeProjectDocs) selected.add('projectDoc')
  const failures: CorpusFailure[] = []
  const entries: CorpusEntry[] = []
  let scannedSources = 0

  const add = (value: CorpusEntry | null): void => {
    if (!value) return
    scannedSources += 1
    entries.push(value)
  }

  const [characters, outlines, events, chapters, settings, notes, relationshipDocument] = await Promise.all([
    selected.has('character') || selected.has('relationship') || selected.has('event') ? loadCharacterDocuments(store) : Promise.resolve([] as Array<{ doc: CharacterDoc; fileName: string }>),
    selected.has('outline') ? loadOutlineDocuments(store) : Promise.resolve([] as Array<{ doc: OutlineDoc; fileName: string }>),
    selected.has('event') ? loadEventDocuments(store) : Promise.resolve([] as Array<{ doc: StoryEvent; fileName: string }>),
    selected.has('chapter') ? loadChapterDocuments(store) : Promise.resolve([] as Array<{ doc: ChapterDoc; fileName: string }>),
    selected.has('setting') ? loadSettingDocuments(store) : Promise.resolve([] as Array<{ doc: SettingDoc; fileName: string }>),
    selected.has('note') ? loadNoteDocuments(store) : Promise.resolve([] as Array<{ doc: NoteDoc; fileName: string }>),
    selected.has('relationship') ? loadRelationshipDocuments(store) : Promise.resolve(null)
  ])

  for (const { doc, fileName } of characters) {
    const sourcePath = `characters/${fileName}`
    const revision = await sourceRevision(store, sourcePath, failures)
    add(entry('character', doc.id, doc.name, sourcePath, revision, contentRevision(serializeCharacter(doc)), [
      { name: 'name', text: doc.name },
      { name: 'aliases', text: doc.aliases.join('\n') },
      { name: 'role', text: doc.role },
      { name: 'faction', text: doc.faction },
      { name: 'gender', text: doc.gender },
      { name: 'age', text: doc.age },
      { name: 'summary', text: doc.summary },
      { name: 'tags', text: doc.tags.join('\n') },
      { name: 'content', text: doc.content }
    ]))
  }

  const characterNames = new Map(characters.map(({ doc }) => [doc.id, doc]))
  if (relationshipDocument) {
    const sourcePath = 'relationships.json'
    const revision = await sourceRevision(store, sourcePath, failures)
    const nameOf = (id: string) => characterNames.get(id)?.name ?? id
    const writeRevision = contentRevision(serializeRelationships(relationshipDocument.doc, nameOf))
    for (const relation of relationshipDocument.doc) {
      const from = characterNames.get(relation.fromId)
      const to = characterNames.get(relation.toId)
      add(entry('relationship', relation.id, `${from?.name ?? relation.fromId} ${relation.directed ? '→' : '⇄'} ${to?.name ?? relation.toId}`, sourcePath, revision, writeRevision, [
        { name: 'type', text: relation.type },
        { name: 'label', text: relation.label },
        { name: 'description', text: relation.description },
        { name: 'from.name', text: [from?.name ?? '', ...(from?.aliases ?? [])].filter(Boolean).join('\n') },
        { name: 'to.name', text: [to?.name ?? '', ...(to?.aliases ?? [])].filter(Boolean).join('\n') }
      ]))
    }
  }

  for (const { doc, fileName } of outlines) {
    const sourcePath = `outline/${fileName}`
    const revision = await sourceRevision(store, sourcePath, failures)
    add(entry('outline', doc.id, doc.title, sourcePath, revision, contentRevision(serializeOutlineDoc(doc)), [
      { name: 'title', text: doc.title },
      { name: 'content', text: doc.content }
    ]))
  }

  const eventCharacters = new Map(characters.map(({ doc }) => [doc.id, doc]))
  for (const { doc, fileName } of events) {
    const sourcePath = `events/${fileName}`
    const revision = await sourceRevision(store, sourcePath, failures)
    add(entry('event', doc.id, doc.title, sourcePath, revision, contentRevision(serializeEvent(doc)), [
      { name: 'title', text: doc.title },
      { name: 'storyTime', text: doc.storyTime },
      { name: 'location', text: doc.location },
      { name: 'tags', text: doc.tags.join('\n') },
      { name: 'characters.name', text: doc.characterIds.map((id) => eventCharacters.get(id)?.name ?? '').filter(Boolean).join('\n') },
      { name: 'content', text: doc.content }
    ]))
  }

  for (const { doc, fileName } of chapters) {
    const sourcePath = `chapters/${fileName}`
    const revision = await sourceRevision(store, sourcePath, failures)
    add(entry('chapter', doc.id, doc.title, sourcePath, revision, contentRevision(serializeChapter(doc)), [
      { name: 'title', text: doc.title },
      { name: 'volume', text: doc.volume },
      { name: 'terms.term', text: (doc.terms ?? []).map((term) => term.term).join('\n') },
      { name: 'terms.note', text: (doc.terms ?? []).map((term) => term.note ?? '').filter(Boolean).join('\n') },
      { name: 'content', text: doc.content }
    ]))
  }

  for (const { doc, fileName } of settings) {
    const sourcePath = `settings/${fileName}`
    const revision = await sourceRevision(store, sourcePath, failures)
    add(entry('setting', doc.id, doc.title, sourcePath, revision, contentRevision(JSON.stringify(doc, null, 2)), [
      { name: 'title', text: doc.title },
      { name: 'category', text: doc.category },
      { name: 'tags', text: doc.tags.join('\n') },
      { name: 'content', text: doc.content }
    ]))
  }

  for (const { doc, fileName } of notes) {
    const sourcePath = `notes/${fileName}`
    const revision = await sourceRevision(store, sourcePath, failures)
    add(entry('note', doc.id, doc.title, sourcePath, revision, contentRevision(serializeNote(doc)), [
      { name: 'title', text: doc.title },
      { name: 'tags', text: doc.tags.join('\n') },
      { name: 'content', text: doc.content }
    ]))
  }

  if (selected.has('projectDoc')) {
    for (const sourcePath of await listProjectDocPaths(store)) {
      const size = await store.fileSize(sourcePath)
      if (size === null) {
        failures.push({ sourcePath, code: 'NOT_FOUND' })
        continue
      }
      if (size > PROJECT_DOC_MAX_BYTES) {
        failures.push({ sourcePath, code: 'TOO_LARGE' })
        continue
      }
      const bytes = await store.readBytes(sourcePath)
      if (bytes === null) {
        failures.push({ sourcePath, code: 'NOT_FOUND' })
        continue
      }
      let text: string
      try {
        text = await extractTextFromBytes(sourcePath, bytes)
      } catch (error) {
        failures.push({ sourcePath, code: error instanceof TextExtractionError ? error.status.toUpperCase() : 'IO_ERROR' })
        continue
      }
      scannedSources += 1
      const name = sourcePath.slice(sourcePath.lastIndexOf('/') + 1)
      entries.push({
        kind: 'projectDoc',
        id: sourcePath.slice('docs/'.length),
        title: name,
        sourcePath,
        sourceRevision: contentRevision(text),
        writeRevision: contentRevision(text),
        fields: [
          { name: 'name', text: name },
          { name: 'content', text }
        ]
      })
    }
  }

  entries.sort((a, b) => a.kind.localeCompare(b.kind) || a.sourcePath.localeCompare(b.sourcePath) || a.id.localeCompare(b.id))
  const projectRevision = resourceRevision(
    ...entries.map((item) => `${item.sourcePath}:${item.sourceRevision}`),
    ...failures.map((item) => `${item.sourcePath}:${item.code}`)
  )
  return { projectRevision, entries, scannedSources, failedSources: failures }
}
