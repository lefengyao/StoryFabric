import { describe, expect, it } from 'vitest'
import { SYSTEM_PROMPT as CORE_PROMPT } from '../prompts'

describe('agent workspace policy', () => {
  it('spells out both placement contracts', () => {
    expect(CORE_PROMPT).toContain('写入前必须重新读取磁盘最新内容')
    expect(CORE_PROMPT).toContain('绝不能作为写回基线')
    expect(CORE_PROMPT).toContain('不得用旧全文覆盖新文件')
    expect(CORE_PROMPT).toContain('每次调用 save_chapter 都必须显式传 box')
    expect(CORE_PROMPT).toContain('每次调用 save_outline_doc 都必须显式传 kind')
    expect(CORE_PROMPT).toContain('章纲：kind: "chapter"')
    expect(CORE_PROMPT).toContain('普通正文段落首行使用两个全角空格')
  })

  it('requires explicit consent before using delete_note and explains its pending semantics', () => {
    expect(CORE_PROMPT).toContain('对应写入工具：save_character / save_relationship / save_event / save_outline_doc / save_chapter / edit_chapter / append_chapter / save_setting / save_note / delete_note / delete_event / delete_entity / move_chapter / restore_from_trash')
    expect(CORE_PROMPT).toContain('只有当前对话明确关联某便签且用户明确表示任务完成时才询问是否删除')
    expect(CORE_PROMPT).toContain('便签只是任务记录，不代表任务已经完成')
    expect(CORE_PROMPT).toContain('普通聊天中的“完成”不触发')
    expect(CORE_PROMPT).toContain('询问不等于删除')
    expect(CORE_PROMPT).toContain('用户未明确同意时不调用 delete_note')
    expect(CORE_PROMPT).toContain('只有明确同意后才调用 delete_note')
    expect(CORE_PROMPT).toContain('list_notes 或 get_note 核实过的 noteId')
    expect(CORE_PROMPT).toContain('pending 不等于落盘')
    expect(CORE_PROMPT).toContain('成功只能说移入回收站')
    expect(CORE_PROMPT).toContain('删除人物、大纲、事件、章节、设定、便签或项目文档时统一使用 delete_entity')
    expect(CORE_PROMPT).toContain('projectDoc 因没有回收站在确认后直接删除')
    expect(CORE_PROMPT).toContain('全局只有一条主线')
    expect(CORE_PROMPT).toContain('分支不允许合流')
    expect(CORE_PROMPT).toContain('删除事件优先使用 delete_event')
  })
})
