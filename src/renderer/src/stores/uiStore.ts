import { create } from 'zustand'

interface UiState {
  chatPanelOpen: boolean
  setChatPanelOpen: (open: boolean) => void
  openChatPanel: () => void
  closeChatPanel: () => void
  toggleChatPanel: () => void
}

export const useUi = create<UiState>((set, get) => ({
  chatPanelOpen: false,
  setChatPanelOpen: (chatPanelOpen) => set({ chatPanelOpen }),
  openChatPanel: () => set({ chatPanelOpen: true }),
  closeChatPanel: () => set({ chatPanelOpen: false }),
  toggleChatPanel: () => set({ chatPanelOpen: !get().chatPanelOpen })
}))
