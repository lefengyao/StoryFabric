interface HistoryLocation { href: string; state: unknown }
interface HistoryPopEvent { stopImmediatePropagation: () => void }

function historyIndex(location: HistoryLocation): number | null {
  if (typeof location.state !== 'object' || location.state === null || !('idx' in location.state)) return null
  return typeof location.state.idx === 'number' ? location.state.idx : null
}

function sameLocation(a: HistoryLocation, b: HistoryLocation): boolean {
  return a.href === b.href && historyIndex(a) === historyIndex(b)
}

function traversalDelta(from: HistoryLocation, to: HistoryLocation): number {
  // HashRouter numbers each entry. An earlier entry predating the router is before index 0.
  return (historyIndex(to) ?? -1) - (historyIndex(from) ?? -1)
}

/** Restores the current entry while checking edits, then replays the original traversal. */
export function createDocumentHistoryNavigationGuard(options: {
  readLocation: () => HistoryLocation
  go: (delta: number) => void
  shouldGuard: () => boolean
  beforeLeave: () => Promise<boolean>
}): {
  onPopState: (event: HistoryPopEvent) => void
  setCurrentLocation: (location: HistoryLocation) => void
  dispose: () => void
} {
  let current = options.readLocation()
  let disposed = false
  let pending: { origin: HistoryLocation; target: HistoryLocation; asked: boolean; decision: boolean | null; replaying: boolean } | null = null
  const finishAtOrigin = (): void => {
    const request = pending
    if (!request || request.replaying || !sameLocation(options.readLocation(), request.origin)) return
    if (!request.asked) {
      request.asked = true
      void options.beforeLeave().catch(() => false).then((allowed) => {
        if (disposed || pending !== request) return
        request.decision = allowed
        finishAtOrigin()
      })
    } else if (request.decision !== null) {
      if (!request.decision) { pending = null; return }
      request.replaying = true
      options.go(traversalDelta(request.origin, request.target))
    }
  }
  return {
    onPopState: (event) => {
      const destination = options.readLocation()
      if (pending?.replaying && sameLocation(destination, pending.target)) {
        current = destination
        pending = null
        return
      }
      if (!pending && !options.shouldGuard()) {
        current = destination
        return
      }
      if (!pending && sameLocation(destination, current)) { event.stopImmediatePropagation(); return }
      event.stopImmediatePropagation()
      pending ??= { origin: current, target: destination, asked: false, decision: null, replaying: false }
      if (sameLocation(destination, pending.origin)) {
        finishAtOrigin()
        return
      }
      pending.replaying = false
      const delta = traversalDelta(destination, pending.origin)
      if (delta !== 0) options.go(delta)
    },
    setCurrentLocation: (location) => { if (!pending) current = location },
    dispose: () => { disposed = true; pending = null }
  }
}
