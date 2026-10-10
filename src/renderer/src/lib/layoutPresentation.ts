/** Shared layout contracts for text that sits beside controls in narrow flex rows. */
export function compactMetaClass(): string {
  return 'shrink-0 whitespace-nowrap'
}

export function singleLineTextClass(): string {
  return 'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap'
}

/** The chat page owns the richer model selector used with agent capabilities. */
export function shouldShowGlobalModelSelector(routeSegment: string): boolean {
  return routeSegment !== 'chat'
}

export function workbenchShellClass(): string {
  return 'flex h-full min-h-0 flex-col bg-app'
}

export function workbenchTopbarClass(): string {
  return 'flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-line bg-panel/[0.92] px-3 py-2 backdrop-blur-xl sm:px-5'
}

export function workbenchColumnsClass(): string {
  return 'flex min-h-0 min-w-0 flex-1 flex-row'
}

export function contextRingClass(): string {
  return 'group relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full'
}
