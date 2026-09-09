/** Electron 工作区服务适配层：路径签名保留给 IPC，共享规则由 core 维护。 */
import { promises as fs } from 'fs'
import { basename, join, relative, resolve, sep } from 'path'
import { NodeFileStore } from '../../core/storage/nodeFileStore'
import { importWorkspaceArchive } from '../../core/workspace/archive'
import {
  initializeWorkspace as coreInitializeWorkspace,
  loadSummary as coreLoadSummary,
  loadWorkspaceListItem as coreLoadWorkspaceListItem,
  setWorkspaceName as coreSetWorkspaceName,
  listVolumes as coreListVolumes,
  saveVolume as coreSaveVolume,
  deleteVolume as coreDeleteVolume,
  moveChapter as coreMoveChapter,
  readGraphLayout as coreReadGraphLayout,
  validateWorkspace as coreValidateWorkspace,
  writeGraphLayout as coreWriteGraphLayout
} from '../../core/workspace/workspaceService'
import type { ChapterBox, VolumeMeta, WorkspaceListItem, WorkspaceSummary } from '../../shared/types'
import { listTrash as coreListTrash, restoreFromTrash as coreRestoreTrash, purgeTrashEntry as corePurgeTrash } from '../../core/workspace/trash'

function storeOf(root: string): NodeFileStore {
  return new NodeFileStore(root)
}

export function validateWorkspace(root: string): Promise<{ ok: boolean; reason?: string }> {
  return coreValidateWorkspace(storeOf(root))
}

export async function createWorkspace(parentDir: string, name: string): Promise<string> {
  const safeName = name.replace(/[\\/:*?"<>|]/g, '').trim()
  if (!safeName) throw new Error('工作区名称不能为空')
  const root = join(parentDir, safeName)
  try {
    await fs.access(root)
    throw new Error(`文件夹已存在：${safeName}`)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('文件夹已存在')) throw error
  }
  try {
    await fs.mkdir(root, { recursive: true })
    await coreInitializeWorkspace(storeOf(root), safeName)
    return root
  } catch (error) {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

function safeWorkspaceName(name: string): string {
  const safeName = name.replace(/[\\/:*?"<>|]/g, '').trim()
  if (!safeName || safeName === '.' || safeName === '..') throw new Error('工作区名称不能为空')
  return safeName
}

function isChildOf(parent: string, target: string): boolean {
  const rel = relative(parent, target)
  return Boolean(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

/** Import only into a fresh sibling directory, then atomically publish it. */
export async function importWorkspaceIntoNewFolder(parentDir: string, name: string, bytes: Uint8Array): Promise<string> {
  const parent = resolve(parentDir)
  const target = resolve(parent, safeWorkspaceName(name))
  if (!isChildOf(parent, target)) throw new Error('目标工作区必须位于所选文件夹内')
  if (await pathExists(target)) throw new Error(`文件夹已存在：${basename(target)}`)

  const staging = await fs.mkdtemp(join(parent, '.storyfabric-import-'))
  try {
    const stagingStore = new NodeFileStore(staging)
    await importWorkspaceArchive(stagingStore, bytes)
    await coreSetWorkspaceName(stagingStore, safeWorkspaceName(name))
    await fs.rename(staging, target)
    return target
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true })
    throw error
  }
}

export function loadSummary(root: string): Promise<WorkspaceSummary> {
  return coreLoadSummary(storeOf(root), basename(root), root)
}

export function loadWorkspaceListItem(root: string): Promise<WorkspaceListItem> {
  return coreLoadWorkspaceListItem(storeOf(root), basename(root), root)
}

export function listVolumes(root: string): Promise<VolumeMeta[]> { return coreListVolumes(storeOf(root)) }
export function saveVolume(root: string, input: Partial<VolumeMeta> & { id?: string }): Promise<VolumeMeta> { return coreSaveVolume(storeOf(root), input) }
export function deleteVolume(root: string, id: string): Promise<void> { return coreDeleteVolume(storeOf(root), id) }
export function moveChapter(root: string, id: string, target: { box: Exclude<ChapterBox, 'trash'>; volumeId?: string }): Promise<void> { return coreMoveChapter(storeOf(root), id, target) }
export function listTrash(root: string) { return coreListTrash(storeOf(root)) }
export function restoreTrash(root: string, id: string): Promise<void> { return coreRestoreTrash(storeOf(root), id) }
export function purgeTrash(root: string, id: string): Promise<void> { return corePurgeTrash(storeOf(root), id) }

export type GraphLayout = Record<string, { x: number; y: number }>

export function readGraphLayout(root: string): Promise<GraphLayout> {
  return coreReadGraphLayout(storeOf(root))
}

export function writeGraphLayout(root: string, layout: GraphLayout): Promise<void> {
  return coreWriteGraphLayout(storeOf(root), layout)
}
