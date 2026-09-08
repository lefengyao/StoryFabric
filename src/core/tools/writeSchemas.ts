/**
 * Shared JSON schemas for the two writes whose destination must be explicit.
 * Keeping these contracts in one module prevents core and desktop tools from
 * teaching the agent different placement rules.
 */
export const AGENT_OUTLINE_DOC_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: '更新已有文档时必填' },
    title: { type: 'string' },
    order: { type: 'number' },
    kind: { type: 'string', enum: ['total', 'chapter'], description: '文档类型：total=总纲，chapter=章纲' },
    chapterId: { type: 'string', description: '章纲关联的章节 id；kind 为 chapter 时必填' },
    content: { type: 'string' }
  },
  required: ['kind']
} as const

export const AGENT_CHAPTER_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: '更新已有章节时必填' },
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
