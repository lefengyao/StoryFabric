import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RunActivityDetails } from '../RunActivityDetails'

describe('RunActivityDetails', () => {
  it('shows a collapsed summary and expandable skill, tool, and rule details', () => {
    const markup = renderToStaticMarkup(<RunActivityDetails activity={{
      skills: [{ packageId: 'writing', skillId: 'outline', version: '1.0', stages: ['draft'] }],
      tools: [{ name: 'list_notes', count: 2, failed: 1 }],
      rules: [{ id: 'voice', source: 'project', target: 'chapter', key: 'tone' }]
    }} />)
    expect(markup).toContain('<details')
    expect(markup).not.toContain('<details open')
    expect(markup).toContain('Skill 1')
    expect(markup).toContain('工具 2')
    expect(markup).toContain('writing:outline')
    expect(markup).toContain('list_notes')
    expect(markup).toContain('project · chapter.tone')
  })
})
