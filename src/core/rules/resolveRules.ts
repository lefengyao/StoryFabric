import type { Rule, RuleLayer, RuleSource } from './types'

const ORDER: RuleSource[] = ['builtin', 'application', 'workspace', 'session', 'run']

export interface RuleOverride { rule: Rule; overriddenBy: Rule; source: RuleSource }
export interface RuleConflict { source: RuleSource; key: string; rules: Rule[] }
export interface ResolvedRules {
  layers: RuleLayer[]
  effective: Array<Rule & { source: RuleSource }>
  overridden: RuleOverride[]
  conflicts: RuleConflict[]
  snapshot: { parserVersion: 1; hash: string }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`
  return JSON.stringify(value)
}

function hash(text: string): string {
  let result = 2166136261
  for (let index = 0; index < text.length; index++) { result ^= text.charCodeAt(index); result = Math.imul(result, 16777619) }
  return (result >>> 0).toString(16).padStart(8, '0')
}

export function resolveRules(inputLayers: RuleLayer[], options: { customPrompt?: string } = {}): ResolvedRules {
  const layers = inputLayers.map((layer) => ({ source: layer.source, rules: layer.rules.map((rule) => ({ ...rule })) }))
  if (options.customPrompt?.trim() && !layers.some((layer) => layer.rules.some((rule) => rule.id === 'legacy.custom-prompt'))) {
    const application = layers.find((layer) => layer.source === 'application')
    if (application) application.rules.push({ id: 'legacy.custom-prompt', kind: 'guidance', target: 'all', key: 'freeText', value: options.customPrompt.trim(), severity: 'prefer', enabled: true })
    else layers.push({ source: 'application', rules: [{ id: 'legacy.custom-prompt', kind: 'guidance', target: 'all', key: 'freeText', value: options.customPrompt.trim(), severity: 'prefer', enabled: true }] })
  }
  layers.sort((a, b) => ORDER.indexOf(a.source) - ORDER.indexOf(b.source))
  const conflicts: RuleConflict[] = []
  const effective = new Map<string, Rule & { source: RuleSource }>()
  const overridden: RuleOverride[] = []
  for (const layer of layers) {
    const active = layer.rules.filter((rule) => rule.enabled)
    const byKey = new Map<string, Rule[]>()
    for (const rule of active) byKey.set(rule.key, [...(byKey.get(rule.key) ?? []), rule])
    for (const [key, rules] of byKey) {
      const targetGroups = new Map<string, Rule[]>()
      for (const rule of rules) targetGroups.set(rule.target, [...(targetGroups.get(rule.target) ?? []), rule])
      for (const [target, targetRules] of targetGroups) {
        const targetKey = `${target}\u0000${key}`
      const must = targetRules.filter((rule) => rule.kind === 'constraint' && rule.severity === 'must')
      if (must.length > 1 && new Set(must.map((rule) => stable(rule.value))).size > 1) conflicts.push({ source: layer.source, key, rules: must })
      for (const rule of targetRules) {
        const prior = effective.get(targetKey)
        if (prior) overridden.push({ rule: prior, overriddenBy: rule, source: prior.source })
        effective.set(targetKey, { ...rule, source: layer.source })
      }
      }
    }
  }
  const effectiveRules = [...effective.values()]
  return { layers, effective: effectiveRules, overridden, conflicts, snapshot: { parserVersion: 1, hash: hash(stable({ layers, effective: effectiveRules, conflicts })) } }
}
