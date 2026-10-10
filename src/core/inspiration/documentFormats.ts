/** Formats shared by document readers, attachment validation and file pickers. */
export const TEXT_EXTRACTION_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'yaml', 'yml', 'xml', 'html', 'htm', 'rtf',
  'css', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'java', 'kt', 'kts', 'go', 'rs', 'rb',
  'php', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'swift', 'sql', 'sh', 'bash', 'zsh', 'bat', 'cmd',
  'ps1', 'vue', 'svelte', 'astro', 'toml', 'ini', 'conf', 'log', 'tex'
])

const DOCUMENT_MIMES: Record<string, string> = {
  md: 'text/markdown', markdown: 'text/markdown', csv: 'text/csv', tsv: 'text/tab-separated-values',
  json: 'application/json', yaml: 'application/yaml', yml: 'application/yaml', xml: 'application/xml',
  html: 'text/html', htm: 'text/html', rtf: 'application/rtf',
  epub: 'application/epub+zip', pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
}

export function documentExtension(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot < 0 ? '' : path.slice(dot + 1).toLowerCase()
}

export function isPlainTextDocument(path: string): boolean {
  return TEXT_EXTRACTION_EXTENSIONS.has(documentExtension(path))
}

export function documentMimeType(path: string): string | undefined {
  const ext = documentExtension(path)
  return TEXT_EXTRACTION_EXTENSIONS.has(ext) ? DOCUMENT_MIMES[ext] ?? 'text/plain'
    : ['epub', 'pdf', 'docx'].includes(ext) ? DOCUMENT_MIMES[ext] : undefined
}

export const DOCUMENT_FILE_ACCEPT = [...TEXT_EXTRACTION_EXTENSIONS, 'epub', 'pdf', 'docx'].map((ext) => `.${ext}`).join(',')
