import { singleLineTextClass } from './layoutPresentation'

export function sidebarLabelClass(expanded: boolean): string {
  return expanded ? `hidden ${singleLineTextClass()} shrink-0 text-sm sm:inline-block` : 'hidden text-sm'
}

export function sidebarWidthClass(expanded: boolean): string {
  return expanded ? 'w-[204px]' : 'w-[68px]'
}
