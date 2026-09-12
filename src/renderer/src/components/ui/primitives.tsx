/** 轻量 UI 原语（shadcn 风格、基于 Tailwind token） */
import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/utils'

/* eslint-disable react-refresh/only-export-components */

type Variant = 'primary' | 'ghost' | 'outline' | 'danger' | 'soft'
type Size = 'sm' | 'md' | 'icon'

const variantCls: Record<Variant, string> = {
  primary: 'bg-coral text-white hover:bg-coral-strong shadow-[0_8px_20px_rgba(216,93,73,0.2)]',
  ghost: 'text-muted hover:text-fg hover:bg-elevated',
  outline: 'border border-line bg-panel text-fg hover:bg-elevated',
  danger: 'bg-danger text-white hover:opacity-90',
  soft: 'bg-accent-soft text-accent hover:bg-accent hover:text-accent-fg'
}
const sizeCls: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1 rounded-md',
  md: 'h-9 px-3.5 text-sm gap-1.5 rounded-lg',
  icon: 'h-8 w-8 rounded-lg justify-center'
}

export function Button({
  variant = 'outline',
  size = 'md',
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button
      className={cn(
        'inline-flex items-center whitespace-nowrap font-medium transition-colors select-none cursor-pointer disabled:opacity-50 disabled:pointer-events-none',
        variantCls[variant],
        sizeCls[size],
        className
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  )
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-9 w-full rounded-lg border border-line bg-panel px-3 text-sm text-fg placeholder:text-faint outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition',
        className
      )}
      {...rest}
    />
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rounded-xl border border-line bg-panel shadow-[0_10px_30px_rgba(16,26,56,0.05)]', className)}>{children}</div>
}

export function Badge({
  children,
  tone = 'default',
  className
}: {
  children: ReactNode
  tone?: 'default' | 'accent' | 'danger' | 'ok'
  className?: string
}) {
  const tones = {
    default: 'bg-elevated text-muted',
    accent: 'bg-accent-soft text-accent',
    danger: 'bg-danger-soft text-danger',
    ok: 'bg-elevated text-ok'
  }
  return (
    <span className={cn('inline-flex items-center h-5 px-1.5 rounded text-[11px] font-medium whitespace-nowrap', tones[tone], className)}>
      {children}
    </span>
  )
}

export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      {icon && <div className="text-faint">{icon}</div>}
      <div>
        <div className="text-sm font-medium text-fg">{title}</div>
        {hint && <div className="mt-1 text-xs text-muted max-w-xs">{hint}</div>}
      </div>
      {action}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 size={16} className={cn('animate-spin text-muted', className)} />
}

export function Field({
  label,
  children,
  className,
  hint
}: {
  label: string
  children: ReactNode
  className?: string
  hint?: string
}) {
  return (
    <label className={cn('block', className)}>
      <div className="mb-1.5 text-xs font-medium text-muted">{label}</div>
      {children}
      {hint && <div className="mt-1 text-[11px] leading-4 text-faint">{hint}</div>}
    </label>
  )
}
