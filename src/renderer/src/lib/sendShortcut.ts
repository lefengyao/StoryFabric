/** 聊天发送快捷键判定。'enter' 保持既有行为（裸 Enter 发送、Shift+Enter 换行）。 */
export type SendShortcut = 'enter' | 'mod+enter'

export interface KeyInfo {
  key: string
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  isComposing?: boolean
}

export function shouldSendOnKey(shortcut: SendShortcut, event: KeyInfo): boolean {
  if (event.key !== 'Enter' || event.isComposing) return false
  if (shortcut === 'mod+enter') return (event.metaKey || event.ctrlKey) && !event.shiftKey
  return !event.shiftKey
}
