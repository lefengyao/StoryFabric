import { describe, expect, it } from 'vitest'
import { SYSTEM_PROMPT as CORE_PROMPT } from '../../../core/agent/prompts'
import { SYSTEM_PROMPT as MAIN_PROMPT } from '../prompts'

describe('desktop agent prompt', () => {
  // 主进程只重新导出核心提示词，这个断言防止两端策略漂移。
  it('keeps core and desktop prompts identical', () => {
    expect(MAIN_PROMPT).toBe(CORE_PROMPT)
  })
})
