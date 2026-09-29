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
  clipboardReadText: () => ipcRenderer.invoke(IPC.ClipboardReadText),
  clipboardWriteText: (text) => ipcRenderer.invoke(IPC.ClipboardWriteText, text),

  pickFolder: () => ipcRenderer.invoke(IPC.PickFolder),
  listWorkspaces: () => ipcRenderer.invoke(IPC.ListWorkspaces),
  listRecentWorkspaces: () => ipcRenderer.invoke(IPC.ListRecentWorkspaces),
  renameWorkspace: (path, name) => ipcRenderer.invoke(IPC.RenameWorkspace, path, name),
  forgetRecentWorkspace: (path) => ipcRenderer.invoke(IPC.ForgetRecentWorkspace, path),
  getDefaultWorkspaceDir: () => ipcRenderer.invoke(IPC.GetDefaultDir),
  createWorkspace: (parentDir, name) => ipcRenderer.invoke(IPC.CreateWorkspace, parentDir, name),
  openWorkspace: (path, options) => ipcRenderer.invoke(IPC.OpenWorkspace, path, options?.requestId),
  openWorkspaceByPath: (path, options) => ipcRenderer.invoke(IPC.OpenWorkspaceByPath, path, options?.requestId),
  closeWorkspace: () => ipcRenderer.invoke(IPC.CloseWorkspace),
  getCurrentWorkspace: () => ipcRenderer.invoke(IPC.GetCurrentWorkspace),
  refreshWorkspace: () => ipcRenderer.invoke(IPC.RefreshWorkspace),
  exportWorkspace: () => ipcRenderer.invoke(IPC.ExportWorkspace),
  importWorkspace: (bytes, fileName, target, options) => ipcRenderer.invoke(IPC.ImportWorkspace, bytes, fileName, target, options?.requestId),
  cancelWorkspaceRequest: (requestId) => ipcRenderer.invoke(IPC.CancelWorkspaceRequest, requestId),
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
  getMemory: (scope: import('../shared/memory').MemoryScope) => ipcRenderer.invoke(IPC.GetMemory, scope),
  updateMemory: (scope: import('../shared/memory').MemoryScope, patch: import('../shared/memory').MemoryUpdate) => ipcRenderer.invoke(IPC.UpdateMemory, scope, patch),
  getUsageRecords: () => ipcRenderer.invoke(IPC.GetUsageRecords),
  getUsageBuckets: () => ipcRenderer.invoke(IPC.GetUsageBuckets),
  getWritingDays: () => ipcRenderer.invoke(IPC.GetWritingDays),
  saveProvider: (input) => ipcRenderer.invoke(IPC.SaveProvider, input),
  deleteProvider: (id) => ipcRenderer.invoke(IPC.DeleteProvider, id),
  fetchModels: (input: FetchModelsInput) => ipcRenderer.invoke(IPC.FetchModels, input),
  getCapabilities: () => ipcRenderer.invoke(IPC.GetCapabilities),
  listCreativePackages: () => ipcRenderer.invoke(IPC.ListCreativePackages),
  installCreativePackage: (input) => ipcRenderer.invoke(IPC.InstallCreativePackage, input),
  setCreativePackageEnabled: (id, version, enabled) => ipcRenderer.invoke(IPC.SetCreativePackageEnabled, id, version, enabled),
  listCreativeRules: () => ipcRenderer.invoke(IPC.ListCreativeRules),
  saveCreativeRules: (layers) => ipcRenderer.invoke(IPC.SaveCreativeRules, layers),
  listInspirationSources: () => ipcRenderer.invoke(IPC.ListInspirationSources),
  importInspirationSource: (input) => ipcRenderer.invoke(IPC.ImportInspirationSource, input),
  importInspirationPath: (path) => ipcRenderer.invoke(IPC.ImportInspirationPath, path),
  removeInspirationSource: (id) => ipcRenderer.invoke(IPC.RemoveInspirationSource, id),
  extractInspirationSource: (id) => ipcRenderer.invoke(IPC.ExtractInspirationSource, id),
  readInspirationSource: (id, maxChars) => ipcRenderer.invoke(IPC.ReadInspirationSource, id, maxChars),
  readInspirationDoc: (name) => ipcRenderer.invoke(IPC.ReadInspirationDoc, name),
  saveInspirationDoc: (name, content) => ipcRenderer.invoke(IPC.SaveInspirationDoc, name, content),
  saveInspirationArtifact: (input) => ipcRenderer.invoke(IPC.SaveInspirationArtifact, input),

  agentRun: (req: RunAgentRequest) => ipcRenderer.invoke(IPC.AgentRun, req),
  compressSessionContext: (sessionId, providerId, model) => ipcRenderer.invoke(IPC.CompressSessionContext, sessionId, providerId, model),
  agentConfirm: (sessionId, changeId, approved) => ipcRenderer.invoke(IPC.AgentConfirm, sessionId, changeId, approved),
  agentAbort: (sessionId) => ipcRenderer.invoke(IPC.AgentAbort, sessionId),
  agentAnswerQuestion: (answer) => ipcRenderer.invoke(IPC.AgentAnswerQuestion, answer),
  agentResolveSkillCandidate: (candidateId, action) => ipcRenderer.invoke(IPC.AgentResolveSkillCandidate, candidateId, action),
  listGoals: () => ipcRenderer.invoke(IPC.ListGoals),
  getGoal: (id) => ipcRenderer.invoke(IPC.GetGoal, id),
  continueGoal: (id) => ipcRenderer.invoke(IPC.ContinueGoal, id),
  stopGoal: (id) => ipcRenderer.invoke(IPC.StopGoal, id),
  replanGoal: (id) => ipcRenderer.invoke(IPC.ReplanGoal, id),
  listSessions: () => ipcRenderer.invoke(IPC.ListSessions),
  createSession: () => ipcRenderer.invoke(IPC.CreateSession),
  exportSession: (id) => ipcRenderer.invoke(IPC.ExportSession, id),
  importSession: (base64, fileName) => ipcRenderer.invoke(IPC.ImportSession, base64, fileName),
  loadSession: (id) => ipcRenderer.invoke(IPC.LoadSession, id),
  deleteSession: (id) => ipcRenderer.invoke(IPC.DeleteSession, id),
  updateSession: (id, patch) => ipcRenderer.invoke(IPC.UpdateSession, id, patch),
  updateSessionModelPreference: (id, value) => ipcRenderer.invoke(IPC.UpdateSessionModelPreference, id, value),
  recoverRunEvents: (runId, afterSeq) => ipcRenderer.invoke(IPC.RecoverRunEvents, runId, afterSeq),
  onAgentEvent: (cb) => {
    const listener = (_e: IpcRendererEvent, envelope: unknown) => cb(envelope as Parameters<typeof cb>[0])
    ipcRenderer.on(IPC.AgentEvent, listener)
    return () => ipcRenderer.removeListener(IPC.AgentEvent, listener)
  },
  onRuntimeAgentEvent: (cb) => {
    const listener = (_e: IpcRendererEvent, envelope: unknown) => cb(envelope as Parameters<typeof cb>[0])
    ipcRenderer.on(IPC.RuntimeAgentEvent, listener)
    return () => ipcRenderer.removeListener(IPC.RuntimeAgentEvent, listener)
  },

}

contextBridge.exposeInMainWorld('api', api)
