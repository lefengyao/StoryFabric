/** Radix Select 封装 */
import * as RSelect from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'

export function SelectOptionItem({ value, label }: { value: string; label: string }) {
  return (
    <RSelect.Item
      value={value}
      className="relative flex items-center select-none rounded-md py-1.5 pl-7 pr-3 text-sm text-fg outline-none data-[highlighted]:bg-elevated cursor-pointer"
    >
      <RSelect.ItemIndicator className="absolute left-2 inline-flex">
        <Check size={13} className="text-accent" />
      </RSelect.ItemIndicator>
      <RSelect.ItemText>{label}</RSelect.ItemText>
    </RSelect.Item>
  )
}

export function Select({
  value,
  onValueChange,
  placeholder,
  children,
  className
}: {
  value?: string
  onValueChange: (v: string) => void
  placeholder?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <RSelect.Root value={value} onValueChange={onValueChange}>
      <RSelect.Trigger
        className={
          className ??
          'inline-flex h-9 items-center justify-between rounded-lg border border-line bg-panel px-3 text-sm text-fg outline-none focus:border-accent data-[placeholder]:text-faint min-w-32 cursor-pointer gap-2'
        }
      >
        <RSelect.Value placeholder={placeholder ?? '请选择'} />
        <RSelect.Icon>
          <ChevronDown size={14} className="text-muted" />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content position="popper" sideOffset={4} className="z-50 max-h-72 overflow-y-auto rounded-lg border border-line bg-panel p-1 shadow-xl">
          <RSelect.Viewport>{children}</RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  )
}
