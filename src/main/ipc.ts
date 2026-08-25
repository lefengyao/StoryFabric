/** 主进程 IPC 装配：把服务注册到 ipcMain */
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
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
  searchProject
} from './services/entityStore'
import type { SettingsService } from './services/settingsService'
import { createWorkspace, loadSummary, validateWorkspace, readGraphLayout, writeGraphLayout } from './services/workspaceService'
import type { AgentService } from './agent/agentLoop'
import type { PublicAppSettings, RunAgentRequest } from '../shared/types'
import type { FetchModelsInput, SettingsPatch } from '../shared/api'
import { fetchProviderModels } from './llm'
import { decryptApiKey } from './services/settingsService'
import { SessionStore } from './services/sessionStore'
import { IPC } from '../shared/ipc'

export interface AppContext {
  win: () => BrowserWindow | null
  settings: SettingsService
  agent: AgentService
}

let currentRoot: string | null = null

function requireRoot(): string {
  if (!currentRoot) throw new Error('尚未打开工作区')
  return currentRoot
}

async function recentPush(settings: SettingsService, path: string): Promise<void> {
  const s = await settings.load()
  const recent = [path, ...s.recentWorkspaces.filter((p) => p !== path)].slice(0, 8)
  await settings.update({ recentWorkspaces: recent, lastWorkspacePath: path })
}

export function registerIpc(ctx: AppContext): void {
  /* ---------- 工作区 ---------- */
  ipcMain.handle(IPC.PickFolder, async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0]
  })

  ipcMain.handle(IPC.GetDefaultDir, async () => app.getPath('documents'))

  ipcMain.handle(IPC.CreateWorkspace, async (_e, parentDir: string, name: string) => createWorkspace(parentDir, name))

  ipcMain.handle(IPC.OpenWorkspace, async (_e, path: string) => {
    const v = await validateWorkspace(path)
    if (!v.ok) throw new Error(v.reason)
    currentRoot = path
    await recentPush(ctx.settings, path)
    return loadSummary(path)
  })

  ipcMain.handle(IPC.CloseWorkspace, async () => {
    currentRoot = null
  })

  ipcMain.handle(IPC.GetCurrentWorkspace, async () => (currentRoot ? loadSummary(currentRoot) : null))
  ipcMain.handle(IPC.RefreshWorkspace, async () => (currentRoot ? loadSummary(currentRoot) : null))
  ipcMain.handle(IPC.GetChapterBody, async (_e, id: string) => getChapterBody(requireRoot(), id))
  ipcMain.handle(IPC.SearchProject, async (_e, query: string) => searchProject(requireRoot(), query))
  ipcMain.handle(IPC.GetGraphLayout, async () => readGraphLayout(requireRoot()))
  ipcMain.handle(IPC.SaveGraphLayout, async (_e, layout) => writeGraphLayout(requireRoot(), layout))

  /* ---------- 实体 ---------- */
  ipcMain.handle(IPC.SaveCharacter, async (_e, doc) => saveCharacter(requireRoot(), doc))
  ipcMain.handle(IPC.DeleteCharacter, async (_e, id: string) => deleteCharacter(requireRoot(), id))
  ipcMain.handle(IPC.SaveRelationships, async (_e, list) => saveRelationships(requireRoot(), list))
  ipcMain.handle(IPC.SaveOutlineDoc, async (_e, doc) => saveOutlineDoc(requireRoot(), doc))
  ipcMain.handle(IPC.DeleteOutlineDoc, async (_e, id: string) => deleteOutlineDoc(requireRoot(), id))
  ipcMain.handle(IPC.SaveEvent, async (_e, doc) => saveEvent(requireRoot(), doc))
  ipcMain.handle(IPC.DeleteEvent, async (_e, id: string) => deleteEvent(requireRoot(), id))
  ipcMain.handle(IPC.SaveChapter, async (_e, doc) => {
    const saved = await saveChapter(requireRoot(), doc)
    const { content: _c, ...meta } = saved
    void _c
    return meta
  })
  ipcMain.handle(IPC.DeleteChapter, async (_e, id: string) => deleteChapter(requireRoot(), id))

  /* ---------- 设置与供应商 ---------- */
  ipcMain.handle(IPC.GetSettings, async (): Promise<PublicAppSettings> => ctx.settings.toPublic(await ctx.settings.load()))

  ipcMain.handle(IPC.UpdateSettings, async (_e, patch: SettingsPatch): Promise<PublicAppSettings> =>
    ctx.settings.toPublic(await ctx.settings.update(patch))
  )

  ipcMain.handle(IPC.SaveProvider, async (_e, input): Promise<PublicAppSettings> => ctx.settings.toPublic(await ctx.settings.saveProvider(input)))
  ipcMain.handle(IPC.DeleteProvider, async (_e, id: string): Promise<PublicAppSettings> => ctx.settings.toPublic(await ctx.settings.deleteProvider(id)))

  ipcMain.handle(IPC.FetchModels, async (_e, input: FetchModelsInput): Promise<string[]> => {
    let apiKey = input.apiKey ?? ''
    if (!apiKey && input.providerId) apiKey = await ctx.settings.apiKeyOf(input.providerId)
    return fetchProviderModels(input.protocol, input.baseUrl, apiKey)
  })

  /* ---------- 智能体 ---------- */
  ipcMain.handle(IPC.AgentRun, async (_e, req: RunAgentRequest) => ctx.agent.run(requireRoot(), req))
  ipcMain.handle(IPC.AgentConfirm, async (_e, changeId: string, approved: boolean) => ctx.agent.confirmChange(changeId, approved))
  ipcMain.handle(IPC.AgentAbort, async (_e, sessionId: string) => ctx.agent.abort(sessionId))

  const sessionStore = (): SessionStore => new SessionStore(requireRoot())
  ipcMain.handle(IPC.ListSessions, async () => sessionStore().list())
  ipcMain.handle(IPC.LoadSession, async (_e, id: string) => sessionStore().load(id))
  ipcMain.handle(IPC.DeleteSession, async (_e, id: string) => sessionStore().delete(id))
  ipcMain.handle(IPC.UpdateSession, async (_e, id: string, patch: { title?: string; archived?: boolean }) => {
    const okFlag = await sessionStore().updateMeta(id, patch)
    if (!okFlag) throw new Error('会话不存在')
  })
}
