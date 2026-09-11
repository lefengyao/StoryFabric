import { describe, expect, it } from 'vitest'
import { validateAgentChapterMove, validateAgentChapterWrite, validateAgentCharacterWrite, validateAgentEventWrite, validateAgentNoteWrite, validateAgentOutlineWrite, validateAgentRelationshipWrite, validateAgentSettingWrite } from '../writeValidation'

describe('agent chapter placement validation', () => {
  it.each([
    ['character', validateAgentCharacterWrite],
    ['event', validateAgentEventWrite],
    ['relationship', validateAgentRelationshipWrite],
    ['setting', validateAgentSettingWrite],
    ['note', validateAgentNoteWrite]
  ])('rejects non-object %s payloads', (_label, validate) => {
    expect(() => validate('str')).toThrow('必须是对象')
    expect(() => validate([])).toThrow('必须是对象')
    expect(() => validate(null)).toThrow('必须是对象')
  })

  it('rejects a chapter write without an explicit box', () => {
    expect(() => validateAgentChapterWrite({ title: '第二章', status: 'draft' })).toThrow('box')
  })

  it('accepts a draft chapter without a volume', () => {
    expect(() => validateAgentChapterWrite({ title: '第二章', box: 'draft', status: 'draft' })).not.toThrow()
  })

  it('requires a volume when writing to the main-text box', () => {
    expect(() => validateAgentChapterWrite({ title: '第二章', box: 'main' })).toThrow('volumeId')
    expect(() => validateAgentChapterWrite({ title: '第二章', box: 'main', volumeId: 'vol_1' })).not.toThrow()
  })

  it('requires a volume when moving into the main-text box', () => {
    expect(() => validateAgentChapterMove({ chapterId: 'cha_2', box: 'main' })).toThrow('volumeId')
    expect(() => validateAgentChapterMove({ chapterId: 'cha_2', box: 'draft' })).not.toThrow()
  })
})

describe('agent outline placement validation', () => {
  it('rejects an outline write without an explicit kind', () => {
    expect(() => validateAgentOutlineWrite({ title: '第二章章纲' })).toThrow('kind')
  })

  it('requires chapterId for a chapter outline', () => {
    expect(() => validateAgentOutlineWrite({ title: '第二章章纲', kind: 'chapter' })).toThrow('chapterId')
    expect(() => validateAgentOutlineWrite({ title: '第二章章纲', kind: 'chapter', chapterId: 'cha_2' })).not.toThrow()
  })

  it('does not allow a chapter id on a total outline', () => {
    expect(() => validateAgentOutlineWrite({ title: '总纲', kind: 'total', chapterId: 'cha_2' })).toThrow('总纲')
    expect(() => validateAgentOutlineWrite({ title: '总纲', kind: 'total' })).not.toThrow()
  })
})
