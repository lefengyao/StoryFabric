export type OrientationCapability = 'none' | 'best-effort' | 'sensor-landscape' | 'lock-landscape'

export interface PlatformCapabilities {
  protocolVersion: 1
  skills: boolean
  rules: boolean
  orchestration: boolean
  subagents: boolean
  goalMode: boolean
  eventRecovery: boolean
  budgets: boolean
  orientation: OrientationCapability
  fileImportExport: boolean
  remoteDeployment: boolean
}

export const MINIMAL_PLATFORM_CAPABILITIES: PlatformCapabilities = {
  protocolVersion: 1,
  skills: false,
  rules: false,
  orchestration: false,
  subagents: false,
  goalMode: false,
  eventRecovery: false,
  budgets: false,
  orientation: 'none',
  fileImportExport: false,
  remoteDeployment: false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizePlatformCapabilities(value: unknown): PlatformCapabilities {
  if (!isRecord(value)) return { ...MINIMAL_PLATFORM_CAPABILITIES }
  if (value.protocolVersion !== 1) throw new Error('不支持的平台能力协议版本')
  const orientation = value.orientation === 'best-effort' || value.orientation === 'sensor-landscape' || value.orientation === 'lock-landscape'
    ? value.orientation
    : 'none'
  return {
    protocolVersion: 1,
    skills: value.skills === true,
    rules: value.rules === true,
    orchestration: value.orchestration === true,
    subagents: value.subagents === true,
    goalMode: value.goalMode === true,
    eventRecovery: value.eventRecovery === true,
    budgets: value.budgets === true,
    orientation,
    fileImportExport: value.fileImportExport === true,
    remoteDeployment: value.remoteDeployment === true
  }
}

export function validatePlatformCapabilities(value: unknown): PlatformCapabilities {
  if (!isRecord(value) || value.protocolVersion !== 1) throw new Error('平台能力协议版本无效')
  return normalizePlatformCapabilities(value)
}
