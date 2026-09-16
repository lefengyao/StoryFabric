import type { PlatformCapabilities } from '../../../../shared/platformCapabilities'

export function orchestrationStartEnabled(capabilities: Pick<PlatformCapabilities, 'orchestration'> | undefined, running: boolean): boolean {
  return !running && capabilities?.orchestration === true
}
