import type { FileStore } from '../storage/fileStore'
import type { RuleLayer } from './types'

function validateLayer(layer: RuleLayer): RuleLayer {
  if (!layer || !['builtin', 'application', 'workspace', 'session', 'run'].includes(layer.source) || !Array.isArray(layer.rules)) throw new Error('规则层无效')
  for (const rule of layer.rules) {
    if (!rule || typeof rule.id !== 'string' || !rule.id.trim() || (rule.kind !== 'constraint' && rule.kind !== 'guidance') || typeof rule.target !== 'string' || !rule.target.trim() || typeof rule.key !== 'string' || !rule.key.trim() || (rule.severity !== 'must' && rule.severity !== 'prefer') || typeof rule.enabled !== 'boolean') throw new Error('规则字段无效')
  }
  return layer
}

export class RuleStore {
  constructor(private readonly store: FileStore, private readonly path = '.storyfabric/creative/rules.json') {}

  async load(): Promise<RuleLayer[]> {
    const text = await this.store.readText(this.path)
    if (!text) return []
    try {
      const value = JSON.parse(text) as unknown
      if (!Array.isArray(value)) return []
      return value.filter((layer): layer is RuleLayer => { try { validateLayer(layer as RuleLayer); return true } catch { return false } })
    } catch { return [] }
  }

  async save(layers: RuleLayer[]): Promise<void> {
    if (!Array.isArray(layers)) throw new Error('规则层必须是数组')
    const validated = layers.map((layer) => validateLayer(layer))
    await this.store.writeText(this.path, JSON.stringify(validated, null, 2))
  }
}
