/** preload：以最小暴露面把 IPC 能力桥接给渲染进程 */
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { IPC } from '../shared/ipc'
import type { StoryFabricApi } from '../shared/api'
import type {
  ChapterDoc,
  CharacterDoc,
  OutlineDoc,
  Relationship,
  RunAgentRequest,
  StoryEvent
} from '../shared/types'
import type { FetchModelsInput, SettingsPatch } from '../shared/api'

const api: StoryFabricApi = {
  pickFolder: () => ipcRenderer.invoke(IPC.PickFolder),
  listWorkspaces: () => ipcRenderer.invoke(IPC.ListWorkspaces),
  getDefaultWorkspaceDir: () => ipcRenderer.invoke(IPC.GetDefaultDir),
  createWorkspace: (parentDir, name) => ipcRenderer.invoke(IPC.CreateWorkspace, parentDir, name),
  openWorkspace: (path) => ipcRenderer.invoke(IPC.OpenWorkspace, path),
  closeWorkspace: () => ipcRenderer.invoke(IPC.CloseWorkspace),
  getCurrentWorkspace: () => ipcRenderer.invoke(IPC.GetCurrentWorkspace),
  refreshWorkspace: () => ipcRenderer.invoke(IPC.RefreshWorkspace),
  exportWorkspace: () => ipcRenderer.invoke(IPC.ExportWorkspace),
  importWorkspace: (bytes, fileName, target) => ipcRenderer.invoke(IPC.ImportWorkspace, bytes, fileName, target),
  getChapterBody: (id) => ipcRenderer.invoke(IPC.GetChapterBody, id),
  searchProject: (query) => ipcRenderer.invoke(IPC.SearchProject, query),
  getGraphLayout: () => ipcRenderer.invoke(IPC.GetGraphLayout),
  saveGraphLayout: (layout) => ipcRenderer.invoke(IPC.SaveGraphLayout, layout),

  saveCharacter: (doc: Partial<CharacterDoc>) => ipcRenderer.invoke(IPC.SaveCharacter, doc),
  deleteCharacter: (id) => ipcRenderer.invoke(IPC.DeleteCharacter, id),
  saveRelationships: (list: Relationship[]) => ipcRenderer.invoke(IPC.SaveRelationships, list),
  saveOutlineDoc: (doc: Partial<OutlineDoc>) => ipcRenderer.invoke(IPC.SaveOutlineDoc, doc),
  deleteOutlineDoc: (id) => ipcRenderer.invoke(IPC.DeleteOutlineDoc, id),
  saveEvent: (doc: Partial<StoryEvent>) => ipcRenderer.invoke(IPC.SaveEvent, doc),
  deleteEvent: (id) => ipcRenderer.invoke(IPC.DeleteEvent, id),
  saveChapter: (doc: Partial<ChapterDoc>) => ipcRenderer.invoke(IPC.SaveChapter, doc),
  deleteChapter: (id) => ipcRenderer.invoke(IPC.DeleteChapter, id),
  listVolumes: () => ipcRenderer.invoke(IPC.ListVolumes),
  saveVolume: (input) => ipcRenderer.invoke(IPC.SaveVolume, input),
  deleteVolume: (id) => ipcRenderer.invoke(IPC.DeleteVolume, id),
  moveChapter: (id, target) => ipcRenderer.invoke(IPC.MoveChapter, id, target),
  listTrash: () => ipcRenderer.invoke(IPC.ListTrash),
  restoreTrash: (id) => ipcRenderer.invoke(IPC.RestoreTrash, id),
  purgeTrash: (id) => ipcRenderer.invoke(IPC.PurgeTrash, id),
  listSettings: () => ipcRenderer.invoke(IPC.ListSettingsDocs),
  getSetting: (id) => ipcRenderer.invoke(IPC.GetSetting, id),
  saveSetting: (doc) => ipcRenderer.invoke(IPC.SaveSetting, doc),
  deleteSetting: (id) => ipcRenderer.invoke(IPC.DeleteSetting, id),
  listNotes: () => ipcRenderer.invoke(IPC.ListNotes),
  getNote: (id) => ipcRenderer.invoke(IPC.GetNote, id),
  saveNote: (doc) => ipcRenderer.invoke(IPC.SaveNote, doc),
  deleteNote: (id) => ipcRenderer.invoke(IPC.DeleteNote, id),

  getSettings: () => ipcRenderer.invoke(IPC.GetSettings),
  updateSettings: (patch: SettingsPatch) => ipcRenderer.invoke(IPC.UpdateSettings, patch),
  getUsageRecords: () => ipcRenderer.invoke(IPC.GetUsageRecords),
  saveProvider: (input) => ipcRenderer.invoke(IPC.SaveProvider, input),
  deleteProvider: (id) => ipcRenderer.invoke(IPC.DeleteProvider, id),
  fetchModels: (input: FetchModelsInput) => ipcRenderer.invoke(IPC.FetchModels, input),

  agentRun: (req: RunAgentRequest) => ipcRenderer.invoke(IPC.AgentRun, req),
  agentConfirm: (changeId, approved) => ipcRenderer.invoke(IPC.AgentConfirm, changeId, approved),
  agentAbort: (sessionId) => ipcRenderer.invoke(IPC.AgentAbort, sessionId),
  listSessions: () => ipcRenderer.invoke(IPC.ListSessions),
  createSession: () => ipcRenderer.invoke(IPC.CreateSession),
  exportSession: (id) => ipcRenderer.invoke(IPC.ExportSession, id),
  importSession: (base64, fileName) => ipcRenderer.invoke(IPC.ImportSession, base64, fileName),
  loadSession: (id) => ipcRenderer.invoke(IPC.LoadSession, id),
  deleteSession: (id) => ipcRenderer.invoke(IPC.DeleteSession, id),
  updateSession: (id, patch) => ipcRenderer.invoke(IPC.UpdateSession, id, patch),
  onAgentEvent: (cb) => {
    const listener = (_e: IpcRendererEvent, envelope: unknown) => cb(envelope as Parameters<typeof cb>[0])
    ipcRenderer.on(IPC.AgentEvent, listener)
    return () => ipcRenderer.removeListener(IPC.AgentEvent, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
