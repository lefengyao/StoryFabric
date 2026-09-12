export interface RecentWorkspaceState {
  recentWorkspaces: string[]
  recentWorkspaceOpenedAt: Record<string, string>
}

const MAX_RECENT_WORKSPACES = 8
const ISO_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/

export function markRecentWorkspace(
  state: Partial<RecentWorkspaceState>,
  path: string,
  openedAt = new Date().toISOString()
): RecentWorkspaceState {
  const recentWorkspaces = Array.from(
    new Set([path, ...(state.recentWorkspaces ?? []).filter((item) => item !== path)])
  ).slice(0, MAX_RECENT_WORKSPACES)
  const previousOpenedAt = state.recentWorkspaceOpenedAt ?? {}
  const recentWorkspaceOpenedAt: Record<string, string> = {}

  for (const item of recentWorkspaces) {
    const timestamp = item === path ? openedAt : previousOpenedAt[item]
    if (typeof timestamp === 'string') {
      recentWorkspaceOpenedAt[item] = timestamp
    }
  }

  return { recentWorkspaces, recentWorkspaceOpenedAt }
}

function parseIsoTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined

  const match = ISO_TIMESTAMP_PATTERN.exec(value)
  if (!match) return undefined

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const milliseconds = Number((match[7] ?? '').padEnd(3, '0').slice(0, 3) || 0)
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return undefined

  const calendar = new Date(0)
  calendar.setUTCFullYear(year, month - 1, day)
  calendar.setUTCHours(hour, minute, second, milliseconds)
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    calendar.getUTCHours() !== hour ||
    calendar.getUTCMinutes() !== minute ||
    calendar.getUTCSeconds() !== second ||
    calendar.getUTCMilliseconds() !== milliseconds
  ) {
    return undefined
  }

  const zone = match[8]
  if (zone === 'Z') return calendar.getTime()

  const offsetHours = Number(zone.slice(1, 3))
  const offsetMinutes = Number(zone.slice(4, 6))
  if (offsetHours > 23 || offsetMinutes > 59) return undefined

  const offset = (offsetHours * 60 + offsetMinutes) * (zone[0] === '+' ? 1 : -1)
  return calendar.getTime() - offset * 60_000
}

export function orderRecentWorkspacePaths(
  paths: string[],
  openedAt: Record<string, string> = {}
): string[] {
  return paths
    .map((path, index) => ({ path, index, time: parseIsoTimestamp(openedAt[path]) }))
    .sort((left, right) => {
      const leftHasTime = left.time !== undefined
      const rightHasTime = right.time !== undefined
      if (leftHasTime && rightHasTime) return right.time! - left.time! || left.index - right.index
      if (leftHasTime !== rightHasTime) return leftHasTime ? -1 : 1
      return left.index - right.index
    })
    .map(({ path }) => path)
}
