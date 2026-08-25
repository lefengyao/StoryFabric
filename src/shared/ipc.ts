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
  LoadSession: 'agent:sessions:get',
  DeleteSession: 'agent:sessions:delete',
  UpdateSession: 'agent:sessions:update',
  AgentEvent: 'agent:event'
} as const
