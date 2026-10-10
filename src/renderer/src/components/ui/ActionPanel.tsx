import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'

/** Grouped tools open as a bottom sheet on compact screens. */
export function ActionPanel({ open, onOpenChange, title, description, trigger, children, onCloseAutoFocus }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  trigger: ReactElement
  children: ReactNode
  onCloseAutoFocus?: (event: Event) => void
}): ReactElement {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="action-panel-overlay fixed inset-0 z-[80] bg-[#071024]/40" />
        <Dialog.Content onCloseAutoFocus={onCloseAutoFocus} className="action-panel fixed z-[81] flex flex-col overflow-hidden border border-line bg-panel shadow-2xl focus:outline-none">
          <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-sm font-semibold">{title}</Dialog.Title>
              <Dialog.Description className="mt-0.5 truncate text-xs text-muted">{description}</Dialog.Description>
            </div>
            <Dialog.Close className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-elevated" aria-label={`关闭${title}`}><X size={18} /></Dialog.Close>
          </div>
          <div className="action-panel-content min-h-0 overflow-y-auto overscroll-contain p-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export const actionPanelButtonClass = 'flex min-h-11 min-w-0 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-muted hover:bg-elevated hover:text-fg disabled:opacity-40 disabled:pointer-events-none'
