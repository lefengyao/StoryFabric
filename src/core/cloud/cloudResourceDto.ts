import type { CloudChannel, CloudRedeem, CloudSupplierGroup, CloudSupplierModel, CloudUsage } from '../../shared/cloudAccount'

type Row = Record<string, unknown>
const row = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(row) : []
const text = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined
const number = (value: unknown): number | undefined => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) ? Number(value) : undefined
const id = (value: unknown): string => typeof value === 'string' || typeof value === 'number' ? String(value) : ''

/** Only public resource fields may cross the desktop/web account boundary. */
function group(value: Row): CloudChannel {
  const platform = text(value.platform), description = text(value.description)
  const rate = number(value.rateMultiplier ?? value.rate_multiplier ?? value.rate)
  return { id: id(value.id), name: text(value.name) || '', ...(platform ? { platform } : {}), ...(description ? { description } : {}), ...(rate !== undefined ? { rate } : {}) }
}

export function resourceGroups(value: unknown): CloudChannel[] { return rows(value).map(group) }

function model(value: Row): CloudSupplierModel {
  const cacheReadPrice = number(value.effective_cache_read_price ?? value.cache_read_price)
  const cacheWritePrice = number(value.effective_cache_write_price ?? value.cache_write_price)
  return {
    name: text(value.model_name) || '', billingMode: text(value.billing_mode) || 'token',
    inputPrice: number(value.effective_input_price ?? value.input_price) ?? 0,
    outputPrice: number(value.effective_output_price ?? value.output_price) ?? 0,
    ...(cacheReadPrice !== undefined ? { cacheReadPrice } : {}), ...(cacheWritePrice !== undefined ? { cacheWritePrice } : {})
  }
}

export function resourceLobby(value: unknown): CloudSupplierGroup[] {
  return rows(value).map(value => ({ ...group(value), models: rows(value.models).map(model) }))
}

export function resourceUsage(value: unknown): CloudUsage {
  const data = row(value)
  return {
    items: rows(data.items).map(value => {
      const cost = number(value.cost), createdAt = text(value.createdAt)
      const tokens = [value.inputTokens, value.outputTokens, value.cacheTokens].map(number)
      const totalTokens = number(value.totalTokens) ?? (tokens.some(value => value !== undefined) ? tokens.reduce<number>((sum, value) => sum + (value ?? 0), 0) : undefined)
      return { id: id(value.id), model: text(value.model) || '', ...(totalTokens !== undefined ? { totalTokens } : {}), ...(cost !== undefined ? { cost } : {}), ...(createdAt ? { createdAt } : {}) }
    }),
    total: number(data.total) ?? 0, page: number(data.page) ?? 1, pageSize: number(data.page_size ?? data.pageSize) ?? 20
  }
}

export function resourceRedeem(value: unknown): CloudRedeem {
  const data = row(value), type = text(data.type), amount = number(data.value ?? data.amount), createdAt = text(data.usedAt ?? data.createdAt)
  return { ...(id(data.id) ? { id: id(data.id) } : {}), ...(type ? { type } : {}), ...(amount !== undefined ? { amount } : {}), ...(createdAt ? { createdAt } : {}) }
}

export function resourceRedeems(value: unknown): CloudRedeem[] {
  return rows(Array.isArray(value) ? value : row(value).items).map(resourceRedeem)
}
