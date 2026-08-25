/**
 * 工作区管理：新建（脚手架初始化）、打开校验、加载汇总。
 * 不依赖 electron，当前工作区状态由 IPC 层持有。
 */
import { promises as fs } from 'fs'
import { join, basename } from 'path'
import type { WorkspaceSummary } from '../../shared/types'
import {
  listCharacters,
  loadRelationships,
  listOutline,
  listEvents,
  listChapters
} from './entityStore'

export const WORKSPACE_MARKERS = ['storyfabric.json', 'characters', 'outline', 'events', 'chapters']

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

/** 校验目录是否为有效工作区（存在 storyfabric.json 或完整目录结构） */
export async function validateWorkspace(dir: string): Promise<{ ok: boolean; reason?: string }> {
  const marker = join(dir, 'storyfabric.json')
  if (await exists(marker)) return { ok: true }
  let found = 0
  for (const m of WORKSPACE_MARKERS.slice(1)) {
    if (await exists(join(dir, m))) found++
  }
  if (found >= 3) return { ok: true }
  return { ok: false, reason: '所选文件夹不是有效的 StoryFabric 工作区（缺少 storyfabric.json）' }
}

/** 在 parentDir 下创建名为 name 的工作区并脚手架初始化 */
export async function createWorkspace(parentDir: string, name: string): Promise<string> {
  const safeName = name.replace(/[\\/:*?"<>|]/g, '').trim()
  if (!safeName) throw new Error('工作区名称不能为空')
  const root = join(parentDir, safeName)
  if (await exists(root)) throw new Error(`文件夹已存在：${safeName}`)

  for (const d of ['characters', 'outline', 'events', 'chapters', join('.storyfabric', 'sessions')]) {
    await fs.mkdir(join(root, d), { recursive: true })
  }
  await fs.writeFile(
    join(root, 'storyfabric.json'),
    JSON.stringify({ app: 'storyfabric', version: 1, name: safeName, createdAt: new Date().toISOString() }, null, 2),
    'utf-8'
  )
  await fs.writeFile(join(root, 'relationships.json'), '[]', 'utf-8')
  await fs.writeFile(
    join(root, 'outline', '0001-故事大纲.md'),
    ['---', 'id: out_core', `title: 故事大纲`, 'order: 1', '---', '', '# 故事大纲', '', '在这里写下你的核心创意、主题与整体走向……', ''].join('\n'),
    'utf-8'
  )
  return root
}

/** 加载工作区汇总数据 */
export async function loadSummary(root: string): Promise<WorkspaceSummary> {
  const [characters, relationships, outline, events, chapters] = await Promise.all([
    listCharacters(root),
    loadRelationships(root),
    listOutline(root),
    listEvents(root),
    listChapters(root)
  ])
  let name = basename(root)
  try {
    const meta = JSON.parse(await fs.readFile(join(root, 'storyfabric.json'), 'utf-8'))
    if (typeof meta?.name === 'string' && meta.name) name = meta.name
  } catch {
    /* 使用目录名兜底 */
  }
  return { name, path: root, characters, relationships, outline, events, chapters }
}
