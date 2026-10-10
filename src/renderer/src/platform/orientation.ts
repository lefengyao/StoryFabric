export type OrientationLockResult = 'locked' | 'unsupported' | 'rejected'

export async function requestLandscapeLock(): Promise<OrientationLockResult> {
  const orientation = typeof screen !== 'undefined' ? screen.orientation : undefined
  if (!orientation || typeof orientation.lock !== 'function') return 'unsupported'
  try {
    await orientation.lock('landscape')
    return 'locked'
  } catch {
    return 'rejected'
  }
}
