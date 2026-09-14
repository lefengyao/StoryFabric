export function sidebarLabelClass(expanded: boolean): string {
  return expanded ? 'hidden text-sm sm:inline' : 'hidden text-sm'
}

export function sidebarWidthClass(expanded: boolean): string {
  return expanded ? 'w-[204px]' : 'w-[68px]'
}
