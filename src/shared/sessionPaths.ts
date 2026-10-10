export const SESSION_ROOT = '.storyfabric/sessions'
export const SESSION_JSON = 'session.json'
export const SESSION_TMP = 'tmp'

const SESSION_ID_PATTERN = '[A-Za-z0-9_-]+'
const SESSION_DIR_PATTERN = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-.+-${SESSION_ID_PATTERN}$`)

function localDate(value: number): string {
  const date = new Date(value)
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function safeSessionSlug(value: string): string {
  const normalized = String(value ?? '').normalize('NFKC').trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 32)
  if (!normalized) return 'new-session'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(normalized)) return `${normalized}-session`
  return normalized
}

export function safeSessionId(id: string): string {
  const safe = String(id ?? '').replace(/[^A-Za-z0-9_-]/g, '')
  if (!safe) throw new Error('会话 id 无效')
  return safe
}

export function sessionDirName(input: { id: string; title: string; createdAt: number }): string {
  return `${localDate(input.createdAt)}-${safeSessionSlug(input.title)}-${safeSessionId(input.id)}`
}

export function isSafeSessionDir(value: string): boolean {
  return typeof value === 'string' && SESSION_DIR_PATTERN.test(value) && !value.includes('..')
}

export function sessionJsonPath(storageDir: string): string {
  if (!isSafeSessionDir(storageDir)) throw new Error('会话目录名无效')
  return `${SESSION_ROOT}/${storageDir}/${SESSION_JSON}`
}

export function sessionTmpPath(storageDir: string): string {
  if (!isSafeSessionDir(storageDir)) throw new Error('会话目录名无效')
  return `${SESSION_ROOT}/${storageDir}/${SESSION_TMP}`
}

export function legacySessionPath(id: string): string {
  return `${SESSION_ROOT}/${safeSessionId(id)}.json`
}

export function legacySessionBackupPath(fileName: string): string {
  if (!/^[A-Za-z0-9_-]+\.json$/.test(fileName)) throw new Error('旧会话文件名无效')
  return `${SESSION_ROOT}/legacy/${fileName}`
}
