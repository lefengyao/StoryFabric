import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { TrashEntry } from '../../../../../shared/types'
import { ChapterTrashRow } from '../ChaptersPage'

const chapter: TrashEntry = {
  id: 'cha_trash_1',
  kind: 'chapter',
  title: '待永久删除章节',
  originalPath: 'chapters/draft/待永久删除章节.md',
  deletedAt: 1
}

describe('ChapterTrashRow', () => {
  it('renders separate restore and permanently-delete controls for a chapter', () => {
    const markup = renderToStaticMarkup(<ChapterTrashRow item={chapter} onRestore={vi.fn()} onPurge={vi.fn()} />)

    expect(markup).toContain('title="恢复"')
    expect(markup).toContain('title="永久删除"')
    expect(markup).toContain('待永久删除章节')
  })
})
