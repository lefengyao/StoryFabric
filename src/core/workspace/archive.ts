import JSZip from 'jszip'
import type { FileStore } from '../storage/fileStore'

export interface WorkspaceArchive {
  fileName: string
  base64: string
}

const ROOT_DIRS = ['characters', 'outline', 'settings', 'events', 'chapters', 'notes', '.storyfabric']

function safeEntry(path: string): string | null {
  const normalized = path.replaceAll('\\', '/').replace(/^\/+/, '')
  if (!normalized || normalized.includes('\0')) return null
  const parts = normalized.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) return null
  return normalized
}

async function addTree(zip: JSZip, store: FileStore, dir: string): Promise<void> {
  for (const file of await store.listFiles(dir)) {
    const path = dir ? `${dir}/${file}` : file
    const text = await store.readText(path)
    if (text !== null) zip.file(path, text)
  }
  for (const child of await store.listDirs(dir)) {
    await addTree(zip, store, dir ? `${dir}/${child}` : child)
  }
}

export async function exportWorkspaceArchive(store: FileStore, name: string): Promise<WorkspaceArchive> {
  const zip = new JSZip()
  for (const file of await store.listFiles('')) {
    const text = await store.readText(file)
    if (text !== null) zip.file(file, text)
  }
  for (const dir of ROOT_DIRS) await addTree(zip, store, dir)
  return {
    fileName: `${name.replace(/[\\/:*?"<>|]/g, '').trim() || 'storyfabric'}.storyfabric.zip`,
    base64: await zip.generateAsync({ type: 'base64', compression: 'DEFLATE' })
  }
}

export async function importWorkspaceArchive(store: FileStore, base64: string): Promise<void> {
  const zip = await JSZip.loadAsync(base64, { base64: true })
  const entries = Object.values(zip.files)
  let count = 0
  for (const entry of entries) {
    if (entry.dir) continue
    const path = safeEntry(entry.name)
    if (!path) throw new Error('工作区压缩包包含非法路径')
    const text = await entry.async('text')
    await store.writeText(path, text)
    count++
  }
  if (!count || !(await store.exists('storyfabric.json'))) throw new Error('压缩包不是有效的 StoryFabric 工作区')
}
