/** 主进程 IPC 装配：把服务注册到 ipcMain */
import { app, BrowserWindow, clipboard, dialog, ipcMain } from 'electron'
import { promises as fs } from 'node:fs'
import {
  deleteChapter,
  deleteCharacter,
  deleteEvent,
  deleteOutlineDoc,
  getChapterBody,
  saveChapter,
  saveCharacter,
  saveEvent,
  saveOutlineDoc,
  saveRelationships,
  searchProject,
  deleteNote,
  deleteSetting,
  getNote,
  getSetting,
  listNotes,
  listSettings,
  saveNote,
  saveSetting
} from './services/entityStore'
import type { SettingsService } from './services/settingsService'
import type { UsageService } from '../core/usage/usageService'
import { createWorkspace, deleteVolume, importWorkspaceIntoNewFolder, listTrash, listVolumes, listWorkspaces as listLocalWorkspaces, loadSummary, loadWorkspaceListItem, moveChapter, purgeTrash, readGraphLayout, restoreTrash, saveVolume, validateWorkspace, writeGraphLayout } from './services/workspaceService'
import type { AgentService } from './agent/agentLoop'
import type { DeployService } from './services/deployService'
import type {
  DeployConnectionInput,
  DeployProgress,
  DeployTargetInput,
  PublicAppSettings,
  RunAgentRequest
} from '../shared/types'
import type { FetchModelsInput, SettingsPatch, StoryFabricApi, WorkspaceImportTarget } from '../shared/api'
import { fetchProviderModels } from '../core/llm'
import { decryptApiKey } from './services/settingsService'
import type { PlatformCapabilities } from '../shared/platformCapabilities'
import { SessionStore } from './services/sessionStore'
import { NodeFileStore } from '../core/storage/nodeFileStore'
import { exportWorkspaceArchive } from '../core/workspace/archive'
import { decodeSessionArchive, exportSessionArchive } from '../core/workspace/sessionArchive'
import { genId } from '../core/workspace/entityStore'
import { IPC } from '../shared/ipc'
import { orderRecentWorkspacePaths } from '../shared/recentWorkspaces'
import { serializeWorkspace } from './services/workspaceRuntime'
import { throwIfWorkspaceRequestAborted } from '../shared/api'
import type { RunReplay } from '../shared/runEvents'

export interface AppContext {
  win: () => BrowserWindow | null
  settings: SettingsService
  agent: AgentService
  usage: UsageService
  deploy: DeployService
  runtimeEvents: { replay: (workspaceId: string, runId: string, afterSeq?: number) => RunReplay }
}

let currentRoot: string | null = null
const workspaceRequestControllers = new Map<string, AbortController>()

function requireRoot(): string {
  if (!currentRoot) throw new Error('尚未打开工作区')
  return currentRoot
}

async function recentPush(settings: SettingsService, path: string, signal?: AbortSignal): Promise<void> {
  await settings.recordRecentWorkspace(path, signal)
}

async function recentPushBestEffort(settings: SettingsService, path: string, signal?: AbortSignal): Promise<void> {
  try {
    await recentPush(settings, path, signal)
  } catch (error) {
    throwIfWorkspaceRequestAborted(signal)
    console.warn('[storyfabric] failed to persist recent workspace record')
  }
}

function requestSignal(requestId?: string): AbortSignal | undefined {
  if (!requestId) return undefined
  let controller = workspaceRequestControllers.get(requestId)
  if (!controller) {
    controller = new AbortController()
    workspaceRequestControllers.set(requestId, controller)
  }
  return controller.signal
}

function finishRequest(requestId?: string): void {
  if (requestId) {
    workspaceRequestControllers.delete(requestId)
  }
}

export function registerIpc(ctx: AppContext): void {
  /* ---------- 剪贴板 ---------- */
  ipcMain.handle(IPC.ClipboardReadText, async () => clipboard.readText())
  ipcMain.handle(IPC.ClipboardWriteText, async (_event, text: unknown) => {
    clipboard.writeText(typeof text === 'string' ? text : '')
  })

  /* ---------- 工作区 ---------- */
  ipcMain.handle(IPC.PickFolder, async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0]
  })

  ipcMain.handle(IPC.ListWorkspaces, async () => {
    return listLocalWorkspaces(app.getPath('documents'))
  })

  ipcMain.handle(IPC.CancelWorkspaceRequest, async (_e, requestId: string) => {
    workspaceRequestControllers.get(requestId)?.abort()
  })

  ipcMain.handle(IPC.ListRecentWorkspaces, async () => {
    const settings = await ctx.settings.load()
    const paths = orderRecentWorkspacePaths(settings.recentWorkspaces, settings.recentWorkspaceOpenedAt)
    const result = []
    for (const path of paths) {
      try {
        const valid = await validateWorkspace(path)
        if (!valid.ok) continue
        const item = await loadWorkspaceListItem(path)
        result.push({ ...item, lastOpenedAt: settings.recentWorkspaceOpenedAt[path] })
        if (result.length >= 5) break
      } catch { /* Skip unavailable recent folders. */ }
    }
    return result
  })

  ipcMain.handle(IPC.GetDefaultDir, async () => app.getPath('documents'))

  ipcMain.handle(IPC.CreateWorkspace, async (_e, parentDir: string, name: string) => createWorkspace(parentDir, name))

  ipcMain.handle(IPC.OpenWorkspace, async (_e, path: string, requestId?: string) => {
    const signal = requestSignal(requestId)
    try {
      const v = await validateWorkspace(path)
      if (!v.ok) throw new Error(v.reason)
      throwIfWorkspaceRequestAborted(signal)
      await recentPush(ctx.settings, path, signal)
      throwIfWorkspaceRequestAborted(signal)
      currentRoot = path
      return loadSummary(path)
    } finally {
      finishRequest(requestId)
    }
  })
  ipcMain.handle(IPC.OpenWorkspaceByPath, async (_e, path: string, requestId?: string) => {
    const signal = requestSignal(requestId)
    try {
      const value = path.trim()
      if (!value) throw new Error('请输入工作区路径')
      const valid = await validateWorkspace(value)
      if (!valid.ok) throw new Error(valid.reason)
      throwIfWorkspaceRequestAborted(signal)
      await recentPush(ctx.settings, value, signal)
      throwIfWorkspaceRequestAborted(signal)
      currentRoot = value
      return loadSummary(value)
    } finally {
      finishRequest(requestId)
    }
  })

  ipcMain.handle(IPC.CloseWorkspace, async () => {
    currentRoot = null
    await ctx.settings.update({ lastWorkspacePath: undefined })
  })

  ipcMain.handle(IPC.GetCurrentWorkspace, async () => {
    if (!currentRoot) {
      const settings = await ctx.settings.load()
      const lastWorkspacePath = settings.lastWorkspacePath?.trim()
      if (lastWorkspacePath) {
        const valid = await validateWorkspace(lastWorkspacePath)
        if (valid.ok) {
          currentRoot = lastWorkspacePath
        } else {
          await ctx.settings.update({ lastWorkspacePath: undefined })
        }
      }
    }
    return currentRoot ? loadSummary(currentRoot) : null
  })
  ipcMain.handle(IPC.RefreshWorkspace, async () => (currentRoot ? loadSummary(currentRoot) : null))
  ipcMain.handle(IPC.ExportWorkspace, async () => {
    const root = requireRoot()
    return exportWorkspaceArchive(new NodeFileStore(root), (await loadSummary(root)).name)
  })
  ipcMain.handle(IPC.ImportWorkspace, async (_e, bytes: Uint8Array, fileName: string, target?: WorkspaceImportTarget, requestId?: string) => {
    const signal = requestSignal(requestId)
    let root: string | null = null
    try {
      const parentDir = target?.parentDir?.trim()
      if (!parentDir) throw new Error('请选择导入工作区的目标文件夹')
      const derivedName = fileName.replace(/\.storyfabric\.zip$/i, '').replace(/[\\/:*?"<>|]/g, '').trim()
      const workspaceName = target?.name?.trim() || derivedName || '导入工作区'
      root = await importWorkspaceIntoNewFolder(parentDir, workspaceName, bytes, signal)
      throwIfWorkspaceRequestAborted(signal)
      await recentPushBestEffort(ctx.settings, root, signal)
      throwIfWorkspaceRequestAborted(signal)
      const summary = await loadSummary(root)
      throwIfWorkspaceRequestAborted(signal)
      currentRoot = root
      return summary
    } catch (error) {
      if (signal?.aborted && root) await fs.rm(root, { recursive: true, force: true }).catch(() => undefined)
      throw error
    } finally {
      finishRequest(requestId)
    }
  })
  ipcMain.handle(IPC.GetChapterBody, async (_e, id: string) => getChapterBody(requireRoot(), id))
  ipcMain.handle(IPC.SearchProject, async (_e, query: string) => searchProject(requireRoot(), query))
  ipcMain.handle(IPC.GetGraphLayout, async () => readGraphLayout(requireRoot()))
  ipcMain.handle(IPC.SaveGraphLayout, async (_e, layout) => { const root = requireRoot(); return serializeWorkspace(root, () => writeGraphLayout(root, layout)) })

  /* ---------- 实体 ---------- */
  ipcMain.handle(IPC.SaveCharacter, async (_e, doc) => { const root = requireRoot(); return serializeWorkspace(root, () => saveCharacter(root, doc)) })
  ipcMain.handle(IPC.DeleteCharacter, async (_e, id: string) => { const root = requireRoot(); return serializeWorkspace(root, () => deleteCharacter(root, id)) })
  ipcMain.handle(IPC.SaveRelationships, async (_e, list) => { const root = requireRoot(); return serializeWorkspace(root, () => saveRelationships(root, list)) })
  ipcMain.handle(IPC.SaveOutlineDoc, async (_e, doc) => { const root = requireRoot(); return serializeWorkspace(root, () => saveOutlineDoc(root, doc)) })
  ipcMain.handle(IPC.DeleteOutlineDoc, async (_e, id: string) => { const root = requireRoot(); return serializeWorkspace(root, () => deleteOutlineDoc(root, id)) })
  ipcMain.handle(IPC.SaveEvent, async (_e, doc) => { const root = requireRoot(); return serializeWorkspace(root, () => saveEvent(root, doc)) })
  ipcMain.handle(IPC.DeleteEvent, async (_e, id: string) => { const root = requireRoot(); return serializeWorkspace(root, () => deleteEvent(root, id)) })
  ipcMain.handle(IPC.SaveChapter, async (_e, doc) => {
    const root = requireRoot()
    const saved = await serializeWorkspace(root, () => saveChapter(root, doc))
    const { content: _c, ...meta } = saved
    void _c
    return meta
  })
  ipcMain.handle(IPC.DeleteChapter, async (_e, id: string) => { const root = requireRoot(); return serializeWorkspace(root, () => deleteChapter(root, id)) })
  ipcMain.handle(IPC.ListVolumes, async () => listVolumes(requireRoot()))
  ipcMain.handle(IPC.SaveVolume, async (_e, input) => { const root = requireRoot(); return serializeWorkspace(root, () => saveVolume(root, input)) })
  ipcMain.handle(IPC.DeleteVolume, async (_e, id: string) => { const root = requireRoot(); return serializeWorkspace(root, () => deleteVolume(root, id)) })
  ipcMain.handle(IPC.MoveChapter, async (_e, id: string, target) => { const root = requireRoot(); return serializeWorkspace(root, () => moveChapter(root, id, target)) })
  ipcMain.handle(IPC.ListTrash, async () => listTrash(requireRoot()))
  ipcMain.handle(IPC.RestoreTrash, async (_e, id: string) => { const root = requireRoot(); return serializeWorkspace(root, () => restoreTrash(root, id)) })
  ipcMain.handle(IPC.PurgeTrash, async (_e, id: string) => { const root = requireRoot(); return serializeWorkspace(root, () => purgeTrash(root, id)) })
  ipcMain.handle(IPC.ListSettingsDocs, async () => listSettings(requireRoot()))
  ipcMain.handle(IPC.GetSetting, async (_e, id: string) => getSetting(requireRoot(), id))
  ipcMain.handle(IPC.SaveSetting, async (_e, input) => { const root = requireRoot(); return serializeWorkspace(root, () => saveSetting(root, input)) })
  ipcMain.handle(IPC.DeleteSetting, async (_e, id: string) => { const root = requireRoot(); return serializeWorkspace(root, () => deleteSetting(root, id)) })
  ipcMain.handle(IPC.ListNotes, async () => listNotes(requireRoot()))
  ipcMain.handle(IPC.GetNote, async (_e, id: string) => getNote(requireRoot(), id))
  ipcMain.handle(IPC.SaveNote, async (_e, input) => { const root = requireRoot(); return serializeWorkspace(root, () => saveNote(root, input)) })
  ipcMain.handle(IPC.DeleteNote, async (_e, id: string) => { const root = requireRoot(); return serializeWorkspace(root, () => deleteNote(root, id)) })

  /* ---------- 设置与供应商 ---------- */
  ipcMain.handle(IPC.GetSettings, async (): Promise<PublicAppSettings> => ctx.settings.toPublic(await ctx.settings.load()))
  ipcMain.handle(IPC.GetUsageRecords, async () => ctx.usage.list())

  ipcMain.handle(IPC.UpdateSettings, async (_e, patch: SettingsPatch): Promise<PublicAppSettings> =>
    ctx.settings.toPublic(await ctx.settings.update(patch))
  )

  ipcMain.handle(IPC.SaveProvider, async (_e, input): Promise<PublicAppSettings> => ctx.settings.toPublic(await ctx.settings.saveProvider(input)))
  ipcMain.handle(IPC.DeleteProvider, async (_e, id: string): Promise<PublicAppSettings> => ctx.settings.toPublic(await ctx.settings.deleteProvider(id)))

  ipcMain.handle(IPC.FetchModels, async (_e, input: FetchModelsInput): Promise<string[]> => {
    const provider = await ctx.settings.providerInput(input)
    return fetchProviderModels(provider.protocol, provider.baseUrl, provider.apiKey)
  })
  ipcMain.handle(IPC.GetCapabilities, async (): Promise<PlatformCapabilities> => ({ protocolVersion: 1, skills: true, rules: true, orchestration: true, subagents: true, goalMode: true, eventRecovery: true, budgets: true, orientation: 'best-effort', fileImportExport: true, remoteDeployment: true }))
  ipcMain.handle(IPC.ListCreativePackages, async () => ctx.agent.listCreativePackages())
  ipcMain.handle(IPC.InstallCreativePackage, async (_e, input) => ctx.agent.installCreativePackage(undefined, input))
  ipcMain.handle(IPC.SetCreativePackageEnabled, async (_e, id: string, version: string, enabled: boolean) => ctx.agent.setCreativePackageEnabled(undefined, id, version, enabled))
  ipcMain.handle(IPC.ListCreativeRules, async () => ctx.agent.listCreativeRules(requireRoot()))
  ipcMain.handle(IPC.SaveCreativeRules, async (_e, layers) => ctx.agent.saveCreativeRules(requireRoot(), layers))

  /* ---------- 智能体 ---------- */
  ipcMain.handle(IPC.AgentRun, async (_e, req: RunAgentRequest) => ctx.agent.run(requireRoot(), req))
  ipcMain.handle(IPC.AgentConfirm, async (_e, changeId: string, approved: boolean) => ctx.agent.confirmChange(changeId, approved))
  ipcMain.handle(IPC.AgentAbort, async (_e, sessionId: string) => ctx.agent.abort(sessionId))
  ipcMain.handle(IPC.RecoverRunEvents, async (_e, runId: string, afterSeq?: number) => ctx.runtimeEvents.replay(requireRoot(), runId, afterSeq))
  ipcMain.handle(IPC.ListGoals, async () => ctx.agent.listGoals(requireRoot()))
  ipcMain.handle(IPC.GetGoal, async (_e, id: string) => ctx.agent.getGoal(requireRoot(), id))
  ipcMain.handle(IPC.ContinueGoal, async (_e, id: string) => ctx.agent.continueGoal(requireRoot(), id))
  ipcMain.handle(IPC.StopGoal, async (_e, id: string) => ctx.agent.stopGoal(requireRoot(), id))
  ipcMain.handle(IPC.ReplanGoal, async (_e, id: string) => ctx.agent.replanGoal(requireRoot(), id))

  const sessionStore = (): SessionStore => new SessionStore(requireRoot())
  ipcMain.handle(IPC.ListSessions, async () => sessionStore().list())
  ipcMain.handle(IPC.CreateSession, async () => {
    const session = await sessionStore().create()
    await sessionStore().save(session)
    return session
  })
  ipcMain.handle(IPC.ExportSession, async (_e, id: string) => {
    const session = await sessionStore().load(id)
    if (!session) throw new Error('会话不存在')
    return exportSessionArchive(session)
  })
  ipcMain.handle(IPC.ImportSession, async (_e, base64: string, fileName: string) => {
    const imported = decodeSessionArchive(base64)
    const session = { ...imported, id: genId('sess'), title: imported.title || fileName.replace(/\.storyfabric\.session\.json$/i, '') || '导入会话', updatedAt: Date.now(), archived: false }
    await sessionStore().save(session)
    return { id: session.id, title: session.title, updatedAt: session.updatedAt, messageCount: session.messages.filter((m) => m.role === 'user' || m.role === 'assistant').length, archived: false }
  })
  ipcMain.handle(IPC.LoadSession, async (_e, id: string) => sessionStore().load(id))
  ipcMain.handle(IPC.DeleteSession, async (_e, id: string) => sessionStore().delete(id))
  ipcMain.handle(IPC.UpdateSession, async (_e, id: string, patch: Parameters<StoryFabricApi['updateSession']>[1]) => {
    const okFlag = await sessionStore().updateMeta(id, patch)
    if (!okFlag) throw new Error('会话不存在')
  })
  ipcMain.handle(IPC.UpdateSessionModelPreference, async (_e, id: string, value: import('../shared/types').SessionModelPreference) => {
    if (!(await sessionStore().updateModelPreference(id, value))) throw new Error('会话不存在')
  })

  /* ---------- 远程部署（仅桌面端） ---------- */
  const deploySink = (): ((progress: DeployProgress) => void) => {
    return (progress) => ctx.win()?.webContents.send(IPC.DeployEvent, progress)
  }
  ipcMain.handle(IPC.DeployTestConnection, async (_e, input: DeployConnectionInput) => ctx.deploy.testConnection(input))
  ipcMain.handle(IPC.DeployInstall, async (_e, input: DeployTargetInput) => ctx.deploy.install(input, deploySink()))
  ipcMain.handle(IPC.DeployUpdate, async (_e, targetId: string) => ctx.deploy.update(targetId, deploySink()))
  ipcMain.handle(IPC.DeployCancel, async () => ctx.deploy.cancel())
  ipcMain.handle(IPC.DeployLogs, async (_e, targetId: string) => ctx.deploy.logs(targetId))
  ipcMain.handle(IPC.DeployUninstall, async (_e, targetId: string) => ctx.deploy.uninstall(targetId))
  ipcMain.handle(IPC.DeployListTargets, async () => ctx.deploy.listTargets())
  ipcMain.handle(IPC.DeploySaveTarget, async (_e, input: DeployTargetInput) => ctx.deploy.saveTarget(input))
  ipcMain.handle(IPC.DeployDeleteTarget, async (_e, id: string) => ctx.deploy.deleteTarget(id))
}
