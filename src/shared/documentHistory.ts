import type { ChapterDoc, OutlineDoc } from './types'

declare const writeRevisionBrand: unique symbol
declare const historyVersionBrand: unique symbol
export type WriteRevision = string & { readonly [writeRevisionBrand]: true }
export type HistoryVersionId = string & { readonly [historyVersionBrand]: true }
export type DocumentKind = 'chapter' | 'outline'
export type HistorySource = 'manual' | 'automatic' | 'agent' | 'baseline' | 'before-restore' | 'restored'
export type DocumentFor<K extends DocumentKind> = (K extends 'chapter' ? ChapterDoc : OutlineDoc) & { writeRevision: WriteRevision; updatedAt: string }
export type HistoricalDocument<K extends DocumentKind = DocumentKind> = K extends 'chapter' ? Omit<ChapterDoc, 'writeRevision' | 'updatedAt'> : Omit<OutlineDoc, 'writeRevision' | 'updatedAt'>

export interface HistorySaveOptions {
  source: 'manual' | 'automatic' | 'agent'
  label?: string
  baseRevision?: string
  baseText?: string
}
export interface DocumentWriteOptions {
  baseRevision?: string
  baseText?: string
  sourcePath?: string
  establishHistoryBaseline?: boolean
  history?: HistorySaveOptions
}
export interface DocumentSnapshot<K extends DocumentKind = DocumentKind> {
  document: DocumentFor<K>
  writeRevision: WriteRevision
  sourceText: string
}
export interface HistoryVersion {
  schemaVersion: 1
  historyVersionId: HistoryVersionId
  historySequence: number
  entityKind: DocumentKind
  entityId: string
  createdAt: string
  source: HistorySource
  title: string
  wordCount: number
  label: string
  pinned: boolean
  note: string
  sourceWriteRevision: WriteRevision
  restoredFromHistoryVersionId?: HistoryVersionId
}
export interface HistoryVersionRecord<K extends DocumentKind = DocumentKind> extends HistoryVersion {
  document: HistoricalDocument<K>
}
export interface HistoryVersionPatch {
  pinned?: boolean
  label?: string
  note?: string
}
