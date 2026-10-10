import { describe, expect, it } from 'vitest'
import { chapterTextAgentEnabled, chapterTextAgentPurpose, chapterTextAgentTask } from '../chapterTextAgent'

describe('chapter text agents', () => {
  it('builds a normal-mode task that reads the selected chapter and only returns a candidate', () => {
    const task = chapterTextAgentTask('polish', { id: 'chapter-1', title: '雨夜' })
    expect(task).toContain('普通模式AI 润色智能体')
    expect(task).toContain('get_chapter 按 id')
    expect(task).toContain('chapter-1')
    expect(task).toContain('不要调用任何写入工具')
  })

  it('respects both settings toggles independently', () => {
    expect(chapterTextAgentEnabled('polish', { agentTemperature: 70, proseAlternativesEnabled: false, polishAgentEnabled: false })).toBe(false)
    expect(chapterTextAgentEnabled('de-ai', { agentTemperature: 70, proseAlternativesEnabled: false, deAiAgentEnabled: false })).toBe(false)
    expect(chapterTextAgentEnabled('polish', undefined)).toBe(true)
    expect(chapterTextAgentEnabled('de-ai', undefined)).toBe(true)
  })

  it('marks the two chapter actions with distinct observable purposes', () => {
    expect(chapterTextAgentPurpose('polish')).toBe('chapter-polish-candidate')
    expect(chapterTextAgentPurpose('de-ai')).toBe('chapter-de-ai-candidate')
  })
})
