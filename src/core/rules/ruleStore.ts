import type { FileStore } from '../storage/fileStore'
import type { RuleLayer } from './types'

export class RuleStore {
  constructor(private readonly store: FileStore, private readonly path = '.storyfabric/creative/rules.json') {}

  async load(): Promise<RuleLayer[]> {
    const text = await this.store.readText(this.path)
    if (!text) return []
    try {
      const value = JSON.parse(text) as unknown
      if (!Array.isArray(value)) return []
      return value.filter((layer): layer is RuleLayer => Boolean(layer && typeof layer === 'object' && typeof (layer as RuleLayer).source === 'string' && Array.isArray((layer as RuleLayer).rules)))
    } catch { return [] }
  }

  async save(layers: RuleLayer[]): Promise<void> {
    await this.store.writeText(this.path, JSON.stringify(layers, null, 2))
  }
}
