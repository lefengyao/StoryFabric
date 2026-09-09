import { describe, expect, it } from 'vitest'
import type { PendingChange } from '../../../../shared/types'
import { pendingChangeView } from '../pendingChangeView'

function change(patch: Partial<PendingChange>): PendingChange {
  return { id: 'chg_1', toolName: 'save_note', entityKind: 'note', entityId: 'note_1', title: '删除便签：测试', beforeText: '', afterText: '', ...patch }
}

describe('pendingChangeView', () => {
  it('把删除便签渲染为移入回收站的结果说明，而不是内容 diff', () => {
    const view = pendingChangeView(change({ toolName: 'delete_note', beforeText: '# 便签\n内容', afterText: '移入回收站' }))
    expect(view).toEqual({
      variant: 'remove',
      label: '便签',
      caption: '智能体请求删除便签 —— 确认后才会移入回收站',
      outcome: '将移入回收站，可从回收站恢复'
    })
  })

  it('把回收站恢复渲染为恢复结果说明', () => {
    const view = pendingChangeView(
      change({ toolName: 'restore_from_trash', entityKind: 'chapter', beforeText: '{"id":"cha_1"}', afterText: '恢复到 chapters/draft/第一章.md' })
    )
    expect(view).toEqual({
      variant: 'restore',
      label: '章节',
      caption: '智能体请求恢复章节 —— 确认后才会恢复到原位置',
      outcome: '恢复到 chapters/draft/第一章.md'
    })
  })

  it('内容变更保持新建/更新语义', () => {
    expect(pendingChangeView(change({ beforeText: '' })).variant).toBe('create')
    expect(pendingChangeView(change({ beforeText: '' })).caption).toBe('智能体请求新建便签 —— 确认后才会写入工作区')
    expect(pendingChangeView(change({ beforeText: '旧内容' })).variant).toBe('update')
    expect(pendingChangeView(change({ beforeText: '旧内容' })).caption).toBe('智能体请求更新便签 —— 确认后才会写入工作区')
  })

  it('未知实体类型回退为通用标签', () => {
    expect(pendingChangeView(change({ entityKind: 'unknown' as PendingChange['entityKind'] })).label).toBe('实体')
  })

  it('为便签和设定提供中文标签', () => {
    expect(pendingChangeView(change({ entityKind: 'note' })).label).toBe('便签')
    expect(pendingChangeView(change({ entityKind: 'setting' })).label).toBe('设定')
  })
})
