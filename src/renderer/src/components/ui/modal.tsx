/** Radix Dialog 封装 */
import * as RDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  wide?: boolean
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 bg-black/40 z-40 backdrop-blur-[2px] data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out" />
        <RDialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100vw-1rem)]',
            wide ? 'max-w-3xl' : 'max-w-md',
            'max-h-[86vh] overflow-y-auto rounded-xl border border-line bg-panel p-4 shadow-2xl focus:outline-none sm:p-5',
            'data-[state=open]:animate-modal-in data-[state=closed]:animate-modal-out'
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <RDialog.Title className="text-base font-semibold text-fg">{title}</RDialog.Title>
              {description && <RDialog.Description className="mt-1 text-xs text-muted">{description}</RDialog.Description>}
            </div>
            <RDialog.Close className="text-faint hover:text-fg transition cursor-pointer">
              <X size={16} />
            </RDialog.Close>
          </div>
          <div className="mt-4">{children}</div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}
