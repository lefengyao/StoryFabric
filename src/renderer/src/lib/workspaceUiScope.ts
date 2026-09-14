export type UiWorkspaceIdentity = {
  source: string
  path: string
}

export function identityKey(identity: UiWorkspaceIdentity): string {
  return JSON.stringify([identity.source, identity.path])
}

export function workspaceUiKey(identity: UiWorkspaceIdentity): string {
  return identityKey(identity)
}

export function normalizeHttpSource(baseUrl: string): string {
  const root = baseUrl.trim().replace(/\/+$/, '')
  return `http:${root || 'same-origin'}`
}
