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
    baseRevision: { type: 'string', minLength: 1, description: '更新时必填，取自读取工具返回的 revision' },
    title: { type: 'string' },
    order: { type: 'number' },
    kind: { type: 'string', enum: ['total', 'chapter'], description: '文档类型：total=总纲，chapter=章纲' },
    chapterId: { type: 'string', description: '章纲关联的章节 id；kind 为 chapter 时必填' },
    content: { type: 'string' }
  },
  required: ['kind']
} as const

export const AGENT_CHARACTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', minLength: 1, description: '更新已有人物时必填' },
    baseRevision: { type: 'string', minLength: 1, description: '更新时必填，取自读取工具返回的 revision' },
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
    baseRevision: { type: 'string', minLength: 1, description: '基于已有关系集合形成追加前填写' },
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
    baseRevision: { type: 'string', minLength: 1, description: '更新时必填，取自读取工具返回的 revision' },
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
    baseRevision: { type: 'string', minLength: 1, description: '更新时必填，取自读取工具返回的 revision' },
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
    baseRevision: { type: 'string', minLength: 1, description: '更新时必填，取自读取工具返回的 revision' },
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
    baseRevision: { type: 'string', minLength: 1, description: '更新时必填，取自读取工具返回的 revision' },
    title: { type: 'string' },
    volume: { type: 'string' },
    volumeId: { type: 'string', description: '正文箱所属卷 id；box 为 main 时必填' },
    order: { type: 'number' },
    box: { type: 'string', enum: ['draft', 'main'], description: '章节箱位，必须显式填写，不能依赖默认值' },
    status: { type: 'string', enum: ['draft', 'revised', 'final'] },
    content: { type: 'string', description: '章节完整正文' }
  },
  required: ['box']
} as const
