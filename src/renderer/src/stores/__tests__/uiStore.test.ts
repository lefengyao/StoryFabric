import { beforeEach, describe, expect, it } from 'vitest'
import { useUi } from '../uiStore'

describe('uiStore chat panel', () => {
  beforeEach(() => {
    useUi.setState({ chatPanelOpen: false })
  })

  it('opens, closes and toggles the global chat panel', () => {
    useUi.getState().openChatPanel()
    expect(useUi.getState().chatPanelOpen).toBe(true)

    useUi.getState().toggleChatPanel()
    expect(useUi.getState().chatPanelOpen).toBe(false)

    useUi.getState().toggleChatPanel()
    expect(useUi.getState().chatPanelOpen).toBe(true)

    useUi.getState().closeChatPanel()
    expect(useUi.getState().chatPanelOpen).toBe(false)
  })
})
