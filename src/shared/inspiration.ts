/** Contracts for user-supplied reference material kept with a StoryFabric workspace. */

export type InspirationOrigin = 'library' | 'imported'
export type InspirationExtraction = 'ready' | 'unsupported' | 'failed' | 'too-large'
export type InspirationErrorCode = 'INVALID_PATH' | 'NOT_FOUND' | 'TOO_LARGE' | 'UNSUPPORTED' | 'SOURCE_CHANGED'

export interface InspirationSource {
  id: string
  relativePath: string
  displayName: string
  origin: InspirationOrigin
  size: number
  extraction: InspirationExtraction
  extractedChars?: number
  importedAt?: number
}

export interface InspirationImport {
  name: string
  bytes: Uint8Array
}

export type InspirationArtifactTarget = 'skill' | 'rules' | 'docs'

export interface InspirationArtifactInput {
  target: InspirationArtifactTarget
  name: string
  content: string
}
