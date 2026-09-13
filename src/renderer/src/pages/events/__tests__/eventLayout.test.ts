import { describe, expect, it } from 'vitest'
import type { StoryEvent } from '../../../../../shared/types'
import { layoutEventGraph } from '../eventLayout'

function event(id: string, order: number, overrides: Partial<StoryEvent> = {}): StoryEvent {
  return {
    id,
    title: id,
    volumeId: 'vol_a',
    storyTime: '',
    order,
    location: '',
    tags: [],
    characterIds: [],
    prevIds: [],
    nextIds: [],
    branchIds: [],
    content: '',
    ...overrides
  }
}

describe('event layout', () => {
  it('places the global mainline left-to-right across volumes', () => {
    const events = [
      event('main_1', 1, { volumeId: 'vol_a', nextIds: ['main_2'] }),
      event('main_2', 2, { volumeId: 'vol_b', prevIds: ['main_1'] })
    ]
    const layout = layoutEventGraph(events, [
      { id: 'vol_a', title: '第一卷', order: 1 },
      { id: 'vol_b', title: '第二卷', order: 2 }
    ])

    expect(layout.positions.main_1.x).toBeLessThan(layout.positions.main_2.x)
    expect(layout.positions.main_1.y).toBe(0)
    expect(layout.positions.main_2.y).toBe(0)
    expect(layout.volumes.map((volume) => volume.title)).toEqual(['第一卷', '第二卷'])
  })

  it('places branches below their parent event', () => {
    const events = [
      event('main', 1, { branchIds: ['branch_1'] }),
      event('branch_1', 1.1, { branchFromId: 'main', prevIds: ['main'] })
    ]
    const layout = layoutEventGraph(events)

    expect(layout.positions.branch_1.x).toBeGreaterThan(layout.positions.main.x)
    expect(layout.positions.branch_1.y).toBeGreaterThan(layout.positions.main.y)
    expect(layout.branchIds.has('branch_1')).toBe(true)
  })
})
