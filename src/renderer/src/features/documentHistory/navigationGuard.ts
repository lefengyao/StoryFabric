type LeaveGuard = () => Promise<boolean>
const guards = new Set<LeaveGuard>()
let pending: Promise<boolean> | null = null
export function registerDocumentLeaveGuard(guard: LeaveGuard): () => void {
  guards.add(guard)
  return () => { guards.delete(guard) }
}
export function hasDocumentLeaveGuard(): boolean { return guards.size > 0 }
export function prepareDocumentLeave(): Promise<boolean> {
  if (pending) return pending
  pending = (async () => {
    for (const guard of [...guards]) if (!await guard()) return false
    return true
  })().finally(() => { pending = null })
  return pending
}
