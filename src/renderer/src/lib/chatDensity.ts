import type { ChatDensity } from '../../../shared/types'

export interface ChatDensityClasses {
  /** 消息列表的纵向间距 */
  list: string
  userBubble: string
  assistantBubble: string
}

/** 气泡密度：comfortable 与改动前的观感完全一致。 */
export function chatDensityClasses(density: ChatDensity): ChatDensityClasses {
  switch (density) {
    case 'compact':
      return { list: 'space-y-2', userBubble: 'px-3 py-2 text-sm leading-snug', assistantBubble: 'px-3 py-2' }
    case 'spacious':
      return { list: 'space-y-6', userBubble: 'px-5 py-3.5 text-[15px] leading-loose', assistantBubble: 'px-5 py-4' }
    default:
      return { list: 'space-y-4', userBubble: 'px-4 py-2.5 text-sm leading-relaxed', assistantBubble: 'px-4 py-3' }
  }
}
