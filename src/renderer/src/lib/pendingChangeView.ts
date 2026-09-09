import type { PendingChange } from '../../../shared/types'
import { ENTITY_KIND_LABEL } from './utils'

export type PendingChangeVariant = 'create' | 'update' | 'remove' | 'restore'

export interface PendingChangeView {
  variant: PendingChangeVariant
  label: string
  caption: string
  outcome?: string
  /** 确认按钮文案：删除/恢复不应显示「应用写入」。 */
  confirmLabel: string
}

/** 把待确认变更映射为弹窗展示模型：删除/恢复不是内容 diff，单独呈现结果说明。 */
export function pendingChangeView(change: PendingChange): PendingChangeView {
  const label = ENTITY_KIND_LABEL[change.entityKind] ?? '实体'
  if (change.toolName === 'delete_note') {
    return {
      variant: 'remove',
      label,
      caption: `智能体请求删除${label} —— 确认后才会移入回收站`,
      outcome: '将移入回收站，可从回收站恢复',
      confirmLabel: '移入回收站'
    }
  }
  if (change.toolName === 'restore_from_trash') {
    return {
      variant: 'restore',
      label,
      caption: `智能体请求恢复${label} —— 确认后才会恢复到原位置`,
      outcome: change.afterText,
      confirmLabel: '确认恢复'
    }
  }
  const variant: PendingChangeVariant = change.beforeText ? 'update' : 'create'
  return {
    variant,
    label,
    caption: `智能体请求${variant === 'update' ? '更新' : '新建'}${label} —— 确认后才会写入工作区`,
    confirmLabel: '应用写入'
  }
}
