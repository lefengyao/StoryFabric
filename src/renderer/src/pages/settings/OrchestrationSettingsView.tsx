import { CircleAlert } from 'lucide-react'
import { DEFAULT_ORCHESTRATION_PREFERENCES, normalizeOrchestrationPreferences } from '../../../../shared/creative'
import type { PublicAppSettings } from '../../../../shared/types'
import { SEVEN_STAGE_TEMPLATE } from '../../../../core/orchestration/templates'
import type { StageId } from '../../../../core/orchestration/types'
import { Badge, Card, Field, Input } from '../../components/ui/primitives'

const STAGE_LABEL: Record<string, string> = {
  plan: '计划',
  setting: '设定修改',
  prompt: '提示词优化',
  'anti-ai': '去 AI 味优化',
  write: '正文写作',
  polish: '文后润色',
  review: '审查与建议'
}

/** Keeps the configurable stage list executable by including dependencies and removing blocked descendants. */
export function toggleOrchestrationStage(current: string[], stageId: StageId, enabled: boolean): StageId[] {
  const byId = new Map(SEVEN_STAGE_TEMPLATE.map((stage) => [stage.stageId, stage]))
  const affected = new Set<StageId>([stageId])

  const visitDependencies = (id: StageId): void => {
    for (const dependency of byId.get(id)?.dependsOn ?? []) {
      if (affected.has(dependency)) continue
      affected.add(dependency)
      visitDependencies(dependency)
    }
  }
  const visitDependents = (id: StageId): void => {
    for (const candidate of SEVEN_STAGE_TEMPLATE) {
      if (!candidate.dependsOn.includes(id) || affected.has(candidate.stageId)) continue
      affected.add(candidate.stageId)
      visitDependents(candidate.stageId)
    }
  }

  if (enabled) visitDependencies(stageId)
  else visitDependents(stageId)
  const next = new Set(current)
  if (enabled) for (const id of affected) next.add(id)
  else for (const id of affected) next.delete(id)
  return SEVEN_STAGE_TEMPLATE.map((stage) => stage.stageId).filter((id) => next.has(id))
}

export function OrchestrationSettingsView({
  settings,
  update
}: {
  settings: PublicAppSettings
  update: (patch: { orchestrationDefaults: PublicAppSettings['orchestrationDefaults'] }) => Promise<void>
}): React.ReactElement {
  const profile = normalizeOrchestrationPreferences(settings.orchestrationDefaults)
  const providers = settings.providers.filter((provider) => provider.models.length > 0)
  const save = (patch: Partial<PublicAppSettings['orchestrationDefaults']>): void => {
    void update({
      orchestrationDefaults: {
        ...profile,
        ...patch,
        enabledStageIds: patch.enabledStageIds ?? profile.enabledStageIds,
        modelByStage: patch.modelByStage ?? profile.modelByStage
      }
    })
  }

  const changeStage = (stageId: StageId, enabled: boolean): void => {
    save({ enabledStageIds: toggleOrchestrationStage(profile.enabledStageIds, stageId, enabled) })
  }

  const changeModel = (stageId: string, value: string): void => {
    const modelByStage = { ...profile.modelByStage }
    if (!value) delete modelByStage[stageId]
    else {
      const [providerId, model] = value.split('::')
      modelByStage[stageId] = { providerId, model }
    }
    save({ modelByStage })
  }

  const commitLimit = (key: 'maxCalls' | 'maxEstimatedTokens', value: string): void => {
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < 1) return
    save({ [key]: parsed })
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">智能体编排</h2>
        <p className="mt-1 text-xs leading-5 text-muted">为每个阶段指定是否执行及使用的模型。启用时会自动包含上游依赖；关闭上游时会一并停用依赖它的阶段。</p>
      </div>

      <Card className="space-y-4 p-4">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={profile.enabled}
            onChange={(event) => save({ enabled: event.target.checked })}
            className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
          />
          <span>
            <span className="block font-medium">启用多智能体编排</span>
            <span className="mt-1 block text-xs leading-5 text-muted">关闭时使用基础单智能体模式；开启后每次创作可能产生多次模型调用。</span>
          </span>
        </label>
        {profile.enabled && (
          <div className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs leading-5 text-danger">
            <CircleAlert size={15} className="mt-0.5 shrink-0" />
            <span>编排会消耗更多额度。请根据供应商限额设置阶段、调用次数和预计 Token 上限。</span>
          </div>
        )}
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={profile.subagentsEnabled}
            onChange={(event) => save({ subagentsEnabled: event.target.checked })}
            className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
          />
          <span>
            <span className="block font-medium">允许子智能体协作</span>
            <span className="mt-1 block text-xs leading-5 text-muted">仅允许受限的一级只读子任务；执行时仍受总调用次数和 Token 上限约束。</span>
          </span>
        </label>
      </Card>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(11rem,0.9fr)] gap-3 border-b border-line bg-elevated/50 px-4 py-3 text-[11px] font-medium text-muted">
          <span>阶段</span>
          <span>执行模型</span>
        </div>
        <div className="divide-y divide-line">
          {SEVEN_STAGE_TEMPLATE.map((stage) => {
            const enabled = profile.enabledStageIds.includes(stage.stageId)
            const model = profile.modelByStage[stage.stageId]
            const value = model ? `${model.providerId}::${model.model}` : ''
            return (
              <div key={stage.stageId} className="grid grid-cols-[minmax(0,1fr)_minmax(11rem,0.9fr)] items-center gap-3 px-4 py-3">
                <label className="flex min-w-0 items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(event) => changeStage(stage.stageId, event.target.checked)}
                    className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                  />
                  <span className="min-w-0 truncate">{STAGE_LABEL[stage.stageId]}</span>
                  {stage.required && <Badge tone="accent">关键</Badge>}
                </label>
                <select
                  value={value}
                  disabled={!enabled}
                  onChange={(event) => changeModel(stage.stageId, event.target.value)}
                  className="set-select min-w-0 text-xs disabled:opacity-50"
                  aria-label={`${STAGE_LABEL[stage.stageId]} 模型`}
                >
                  <option value="">默认对话模型</option>
                  {providers.map((provider) => (
                    <optgroup key={provider.id} label={provider.name}>
                      {provider.models.map((modelName) => <option key={modelName} value={`${provider.id}::${modelName}`}>{modelName}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
            )
          })}
        </div>
      </Card>

      <Card className="grid gap-4 p-4 sm:grid-cols-2">
        <Field label="最大模型调用次数" hint="覆盖单次编排内所有阶段和子智能体。">
          <Input defaultValue={String(profile.maxCalls ?? DEFAULT_ORCHESTRATION_PREFERENCES.maxCalls)} type="number" min={1} onBlur={(event) => commitLimit('maxCalls', event.target.value)} />
        </Field>
        <Field label="预计 Token 上限" hint="达到预算后停止新的模型调用。">
          <Input defaultValue={String(profile.maxEstimatedTokens ?? DEFAULT_ORCHESTRATION_PREFERENCES.maxEstimatedTokens)} type="number" min={1} onBlur={(event) => commitLimit('maxEstimatedTokens', event.target.value)} />
        </Field>
        <p className="text-xs leading-5 text-muted sm:col-span-2">保存后，未运行的编排会话会同步显示新预算；正在运行的会话保留启动时快照，新预算从下一次运行生效。</p>
      </Card>
    </section>
  )
}
