/** 部署步骤序列与推进规则。 */
import type { DeployStep } from '../../shared/types'

export const DEPLOY_STEPS: readonly DeployStep[] = ['connect', 'probe', 'upload', 'build', 'run', 'healthcheck']

export function stepIndex(step: DeployStep): number {
  return DEPLOY_STEPS.indexOf(step)
}

/** 成功则前进；失败停在当前步（可重试）；最后一步成功后返回 null。 */
export function nextStep(current: DeployStep, ok: boolean): DeployStep | null {
  if (!ok) return current
  return DEPLOY_STEPS[stepIndex(current) + 1] ?? null
}
