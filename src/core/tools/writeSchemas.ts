/**
 * Shared JSON schemas for the two writes whose destination must be explicit.
 * Keeping these contracts in one module prevents core and desktop tools from
 * teaching the agent different placement rules.
 */
export const AGENT_OUTLINE_DOC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', description: '更新已有文档时必填' },
    baseRevision: { type: 'string', minLength: 1, description: '更新时必填，取自读取工具返回的 writeRevision；不能使用 sourceRevision' },
    title: { type: 'string' },
    order: { type: 'number' },
    kind: { type: 'string', enum: ['total', 'chapter'], description: '文档类型：total=总纲，chapter=章纲' },
    chapterId: { type: 'string', description: '可选。章纲关联的章节 id；省略表示独立章纲，更新时传空字符串可取消关联' },
    content: { type: 'string' }
  },
  required: ['kind']
} as const

export const AGENT_CHARACTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', minLength: 1, description: '更新已有人物时必填' },
    baseRevision: { type: 'string', minLength: 1, description: '更新时必填，取自读取工具返回的 writeRevision；不能使用 sourceRevision' },
    name: { type: 'string', minLength: 1 },
    aliases: { type: 'array', items: { type: 'string' } },
    role: { type: 'string' },
    faction: { type: 'string' },
    gender: { type: 'string' },
    age: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    content: { type: 'string' }
  }
} as const

export const AGENT_RELATIONSHIP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    baseRevision: { type: 'string', minLength: 1, description: '基于已有关系集合形成追加前填写，取自关系读取结果的 writeRevision' },
    fromCharacterId: { type: 'string', minLength: 1 },
    toCharacterId: { type: 'string', minLength: 1 },
    type: { type: 'string' },
    label: { type: 'string' },
    description: { type: 'string' },
    directed: { type: 'boolean' }
  },
  required: ['fromCharacterId', 'toCharacterId']
} as const

export const AGENT_EVENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', minLength: 1, description: '更新已有事件时必填' },
    baseRevision: { type: 'string', minLength: 1, description: '更新时必填，取自读取工具返回的 writeRevision；不能使用 sourceRevision' },
    title: { type: 'string', minLength: 1 },
    volumeId: { type: 'string', minLength: 1, description: '事件所属卷 id；新建时必填' },
    storyTime: { type: 'string' },
    order: { type: 'number' },
    location: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    characterIds: { type: 'array', items: { type: 'string' } },
    prevIds: { type: 'array', items: { type: 'string' }, maxItems: 1 },
    nextIds: { type: 'array', items: { type: 'string' }, maxItems: 1 },
    branchIds: { type: 'array', items: { type: 'string' } },
    branchFromId: { type: 'string' },
    content: { type: 'string' }
  }
} as const

export const AGENT_SETTING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', minLength: 1, description: '更新已有设定时必填' },
    baseRevision: { type: 'string', minLength: 1, description: '更新时必填，取自读取工具返回的 writeRevision；不能使用 sourceRevision' },
    title: { type: 'string', minLength: 1 },
    category: { type: 'string', enum: ['background', 'other'] },
    tags: { type: 'array', items: { type: 'string' } },
    content: { type: 'string' }
  }
} as const

export const AGENT_NOTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', minLength: 1, description: '更新已有便签时必填' },
    baseRevision: { type: 'string', minLength: 1, description: '更新时必填，取自读取工具返回的 writeRevision；不能使用 sourceRevision' },
    title: { type: 'string', minLength: 1 },
    tags: { type: 'array', items: { type: 'string' } },
    pinned: { type: 'boolean' },
    createdAt: { type: 'number' },
    content: { type: 'string' }
  }
} as const

export const AGENT_CHAPTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', description: '更新已有章节时必填' },
    baseRevision: { type: 'string', minLength: 1, description: '更新时必填，取自读取工具返回的 writeRevision；不能使用 sourceRevision' },
    title: { type: 'string' },
    volume: { type: 'string' },
    volumeId: { type: 'string', description: '正文箱所属卷 id；box 为 main 时必填' },
    order: { type: 'number' },
    box: { type: 'string', enum: ['draft', 'main'], description: '章节箱位：draft 只允许草稿/修订，main 只允许正文/定稿；必须显式填写' },
    status: { type: 'string', enum: ['draft', 'revised', 'body', 'final'], description: 'draft=草稿、revised=修订、body=正文、final=定稿；省略时按箱位默认' },
    content: { type: 'string', description: '仅用于新章节创建的完整正文；已有章节禁止传此字段，局部修改请使用 edit_chapter，末尾续写请使用 append_chapter' },
    replaceAll: { type: 'boolean', description: '兼容旧请求字段；已有章节禁止使用，正文修改请使用 edit_chapter 或 append_chapter' }
  },
  required: ['box']
} as const

export const AGENT_CHAPTER_EDIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chapterId: { type: 'string', minLength: 1 },
    baseRevision: { type: 'string', minLength: 1, description: '取自 get_chapter 或 search_project 的 writeRevision' },
    expectedText: { type: 'string', maxLength: 12000, description: '要替换的唯一连续片段；与 lineStart/lineEnd 二选一' },
    lineStart: { type: 'integer', minimum: 1, description: '1 起始行；与 lineEnd 一起使用' },
    lineEnd: { type: 'integer', minimum: 1, description: '包含在内的结束行；与 lineStart 一起使用' },
    replacement: { type: 'string', maxLength: 12000, description: '替换文本，不得超过旧片段的局部修改上限；可以为空字符串以删除片段' }
  },
  required: ['chapterId', 'baseRevision', 'replacement']
} as const
