/** IPC 通道名常量（主进程注册与 preload 调用共用，避免拼写漂移） */

export const IPC = {
  /* 工作区 */
  PickFolder: 'workspace:pick-folder',
  GetDefaultDir: 'workspace:default-dir',
  CreateWorkspace: 'workspace:create',
  OpenWorkspace: 'workspace:open',
  CloseWorkspace: 'workspace:close',
  GetCurrentWorkspace: 'workspace:current',
  RefreshWorkspace: 'workspace:refresh',
  ExportWorkspace: 'workspace:export',
  ImportWorkspace: 'workspace:import',
  GetChapterBody: 'workspace:chapter-body',
  SearchProject: 'workspace:search',
  GetGraphLayout: 'workspace:graph-layout:get',
  SaveGraphLayout: 'workspace:graph-layout:save',

  /* 实体保存 */
  SaveCharacter: 'entity:save-character',
  DeleteCharacter: 'entity:delete-character',
  SaveRelationships: 'entity:save-relationships',
  SaveOutlineDoc: 'entity:save-outline',
  DeleteOutlineDoc: 'entity:delete-outline',
  SaveEvent: 'entity:save-event',
  DeleteEvent: 'entity:delete-event',
  SaveChapter: 'entity:save-chapter',
  DeleteChapter: 'entity:delete-chapter',
  ListVolumes: 'workspace:volumes:list',
  SaveVolume: 'workspace:volumes:save',
  DeleteVolume: 'workspace:volumes:delete',
  MoveChapter: 'workspace:chapters:move',
  ListTrash: 'workspace:trash:list',
  RestoreTrash: 'workspace:trash:restore',
  PurgeTrash: 'workspace:trash:purge',
  ListSettingsDocs: 'entity:list-settings',
  GetSetting: 'entity:get-setting',
  SaveSetting: 'entity:save-setting',
  DeleteSetting: 'entity:delete-setting',
  ListNotes: 'entity:list-notes',
  GetNote: 'entity:get-note',
  SaveNote: 'entity:save-note',
  DeleteNote: 'entity:delete-note',

  /* 设置 */
  GetSettings: 'settings:get',
  UpdateSettings: 'settings:update',
  SaveProvider: 'settings:save-provider',
  DeleteProvider: 'settings:delete-provider',
  FetchModels: 'settings:fetch-models',

  /* 智能体 */
  AgentRun: 'agent:run',
  AgentConfirm: 'agent:confirm',
  AgentAbort: 'agent:abort',
  ListSessions: 'agent:sessions:list',
  CreateSession: 'agent:sessions:create',
  ExportSession: 'agent:sessions:export',
  ImportSession: 'agent:sessions:import',
  LoadSession: 'agent:sessions:get',
  DeleteSession: 'agent:sessions:delete',
  UpdateSession: 'agent:sessions:update',
  AgentEvent: 'agent:event'
} as const
