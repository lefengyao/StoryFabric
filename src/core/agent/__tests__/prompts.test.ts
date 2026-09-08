import { describe, expect, it } from 'vitest'
import { SYSTEM_PROMPT as CORE_PROMPT } from '../prompts'
import { SYSTEM_PROMPT as MAIN_PROMPT } from '../../../main/agent/prompts'

describe('agent workspace policy', () => {
  it('keeps core and desktop prompts identical', () => {
    expect(MAIN_PROMPT).toBe(CORE_PROMPT)
  })

  it('spells out both placement contracts', () => {
    expect(CORE_PROMPT).toContain('每次调用 save_chapter 都必须显式传 box')
    expect(CORE_PROMPT).toContain('每次调用 save_outline_doc 都必须显式传 kind')
    expect(CORE_PROMPT).toContain('章纲：kind: "chapter"')
    expect(CORE_PROMPT).toContain('普通正文段落首行使用两个全角空格')
  })
})
