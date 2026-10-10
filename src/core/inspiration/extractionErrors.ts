export const MAX_EXTRACTED_TEXT_CHARS = 500_000

export interface ExtractionOptions {
  maxChars?: number
  maxPdfPages?: number
  maxDocxXmlBytes?: number
  onPart?: (part: { title: string; text: string }) => void
}

export class TextExtractionError extends Error {
  constructor(readonly status: 'unsupported' | 'failed' | 'too-large', message: string) {
    super(message)
    this.name = 'TextExtractionError'
  }
}
