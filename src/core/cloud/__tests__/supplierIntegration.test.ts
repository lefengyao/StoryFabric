import { describe, expect, it, vi } from 'vitest'
import { CloudAccountService } from '../cloudAccountService'
import { MemoryCloudCredentialStore } from '../cloudCredential'
import { cloudConfigFromPlatformWebUrl, type OidcClient } from '../oidcClient'

async function signedIn(responses: Record<string, unknown>, subject = 'user-1') {
  const store = new MemoryCloudCredentialStore()
  const identity = { subject }
  await store.write({ refreshToken: 'refresh', identity })
  const summary = { businessUserId: '1', status: 'active', balance: { amount: '12.50', currency: 'USD' }, connection: { applicationId: 'storyfabric', status: 'ready', credentialVersion: 1, configurationVersion: 2, group: { id: '7', name: '创作组' } } }
  const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input))
    const path = url.pathname.replace('/api/v1/integration/storyfabric', '')
    if (path === '/connection/group' && responses[path]) summary.connection = responses[path] as typeof summary.connection
    return new Response(JSON.stringify(path === '/gateway/v1/models' ? responses[path] : { code: 0, data: path === '/onboard' || path === '/account' ? summary : responses[path] }), { headers: { 'content-type': 'application/json' } })
  })
  const client = { refresh: async () => ({ accessToken: 'resource-token', refreshToken: 'refresh-2', expiresAt: Date.now() + 300_000, identity }) } as unknown as OidcClient
  const service = new CloudAccountService(cloudConfigFromPlatformWebUrl('https://accounts.example', 'https://sub2api.example'), store, undefined, fetcher, client)
  expect((await service.getState()).phase).toBe('signed-in')
  return { service, fetcher, summary }
}

describe('supplier group resource integration', () => {
  it('discards saved models from the old group and caches an empty authorized registry', async () => {
    const { service, fetcher } = await signedIn({ '/gateway/v1/models': { data: [{ id: 'new-model' }] }, '/connection/group': { applicationId: 'storyfabric', status: 'ready', credentialVersion: 2, configurationVersion: 3, group: { id: '9', name: '新分组' } } })
    const preferences = { models: ['old-model'], modelSettings: {} }
    expect((await service.publicProvider(preferences))?.models).toEqual(['new-model'])
    await service.selectGroup({ groupId: '9', expectedCredentialVersion: 1, operationId: 'operation_1234567890' })
    expect((await service.publicProvider(preferences))?.models).toEqual(['new-model'])
    expect(fetcher.mock.calls.filter(([input]) => String(input).endsWith('/gateway/v1/models'))).toHaveLength(2)

    const empty = await signedIn({ '/gateway/v1/models': { data: [] } })
    expect((await empty.service.publicProvider(preferences))?.models).toEqual([])
    expect((await empty.service.publicProvider(preferences))?.models).toEqual([])
    expect(empty.fetcher.mock.calls.filter(([input]) => String(input).endsWith('/gateway/v1/models'))).toHaveLength(1)
  })

  it('preserves manual model preferences only for their current account and group', async () => {
    const { service } = await signedIn({ '/gateway/v1/models': { data: [{ id: 'new-model' }] }, '/connection/group': { applicationId: 'storyfabric', status: 'ready', credentialVersion: 2, configurationVersion: 3, group: { id: '9', name: '新分组' } } })
    const preferences = await service.scopeModelPreferences({ models: ['manual-model'], modelSettings: {} })
    expect((await service.publicProvider(preferences))?.models).toEqual(['manual-model'])
    const otherAccount = await signedIn({ '/gateway/v1/models': { data: [{ id: 'other-model' }] } }, 'user-2')
    expect((await otherAccount.service.publicProvider(preferences))?.models).toEqual(['other-model'])
    await service.selectGroup({ groupId: '9', expectedCredentialVersion: 1, operationId: 'operation_1234567890' })
    expect((await service.publicProvider(preferences))?.models).toEqual(['new-model'])
    const updated = await service.scopeModelPreferences({ models: ['manual-in-new-group'], modelSettings: {} })
    expect(updated.modelScope).not.toBe(preferences.modelScope)
    expect((await service.publicProvider(updated))?.models).toEqual(['manual-in-new-group'])
  })

  it('invalidates a loaded registry when account reload sees an externally changed group', async () => {
    const responses = { '/gateway/v1/models': { data: [{ id: 'old-model' }] } }
    const { service, summary } = await signedIn(responses)
    expect((await service.publicProvider())?.models).toEqual(['old-model'])
    summary.connection.configurationVersion = 3
    summary.connection.group = { id: '9', name: '新分组' }
    responses['/gateway/v1/models'].data = [{ id: 'new-model' }]
    await service.getAccount()
    expect((await service.publicProvider())?.models).toEqual(['new-model'])
  })

  it('normalizes lobby prices and only exposes public fields', async () => {
    const { service, fetcher } = await signedIn({ '/groups/lobby': [{ id: 7, name: '创作组', platform: 'openai', description: '小说创作', rate_multiplier: 0.5, credentials: { api_key: 'private' }, base_url: 'https://private.example', models: [{ model_name: 'novel-model', billing_mode: 'token', input_price: 2, output_price: 6, effective_input_price: 1, effective_output_price: 3, mapping_name: 'private-model', api_key: 'private' }] }] })
    const result = await service.getSupplierLobby()
    expect(result).toEqual([{ id: '7', name: '创作组', platform: 'openai', description: '小说创作', rate: 0.5, models: [{ name: 'novel-model', billingMode: 'token', inputPrice: 1, outputPrice: 3 }] }])
    expect(JSON.stringify(result)).not.toMatch(/private|credentials|mapping_name|api_key|base_url/)
    expect(fetcher).toHaveBeenLastCalledWith('https://sub2api.example/api/v1/integration/storyfabric/groups/lobby', expect.objectContaining({ headers: { authorization: 'Bearer resource-token' } }))
  })

  it('selects the group through the canonical scoped route with version and idempotency', async () => {
    const { service, fetcher } = await signedIn({ '/connection/group': { applicationId: 'storyfabric', status: 'ready', credentialVersion: 2, configurationVersion: 3, group: { id: '9', name: '新分组' } } })
    await expect(service.selectGroup({ groupId: '9', expectedCredentialVersion: 1, operationId: 'operation_1234567890' })).resolves.toMatchObject({ configurationVersion: 3, group: { id: '9' } })
    expect(fetcher).toHaveBeenLastCalledWith('https://sub2api.example/api/v1/integration/storyfabric/connection/group', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ groupId: '9', expectedCredentialVersion: 1 }), headers: expect.objectContaining({ 'Idempotency-Key': 'operation_1234567890' }) }))
  })

  it('maps paginated resource usage and redemption history into the public API', async () => {
    const { service } = await signedIn({ '/usage': { items: [{ id: '1', model: 'novel-model', inputTokens: 10, outputTokens: 20, cacheTokens: 5, cost: '0.003', createdAt: '2026-10-06T00:00:00Z', api_key: 'private' }], total: 1, page: 2, page_size: 20 }, '/redeem/history': { items: [{ id: '4', type: 'balance', value: 8, usedAt: '2026-10-06T00:00:00Z', code: 'secret' }], total: 1, page: 1, page_size: 20 } })
    await expect(service.getUsage(2)).resolves.toEqual({ items: [{ id: '1', model: 'novel-model', totalTokens: 35, cost: 0.003, createdAt: '2026-10-06T00:00:00Z' }], total: 1, page: 2, pageSize: 20 })
    await expect(service.getRedeemHistory()).resolves.toEqual([{ id: '4', type: 'balance', amount: 8, createdAt: '2026-10-06T00:00:00Z' }])
  })

  it('maps resource group rates and keeps the old client method on group data', async () => {
    const { service, fetcher } = await signedIn({ '/groups': [{ id: 7, name: '创作组', platform: 'openai', rateMultiplier: 0.5, key: 'private' }] })
    await expect(service.getGroups()).resolves.toEqual([{ id: '7', name: '创作组', platform: 'openai', rate: 0.5 }])
    await service.getChannels()
    expect(String(fetcher.mock.calls.at(-1)?.[0]).endsWith('/groups')).toBe(true)
  })
})
