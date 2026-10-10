export interface ChatTypographySettings {
  chatFontSize?: number
}

export const CHAT_FONT_SIZES = [13, 14, 16, 18, 20] as const

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 14
  return Math.round(Math.min(max, Math.max(min, value)))
}

export function chatTypographyStyle(settings: ChatTypographySettings): Record<string, string> {
  const size = clamp(settings.chatFontSize ?? 14, 13, 20)
  return {
    '--chat-font-size': `${size}px`,
    '--chat-font-meta-size': `${Math.max(11, size - 2)}px`,
    '--chat-font-micro-size': `${Math.max(9, size - 4)}px`
  }
}
