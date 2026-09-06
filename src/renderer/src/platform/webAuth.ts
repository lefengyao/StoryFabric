export async function checkWebSession(): Promise<boolean> {
  const response = await fetch('/api/auth/session', { credentials: 'include' })
  if (!response.ok) throw new Error(`认证服务不可用（HTTP ${response.status}）`)
  const payload = await response.json() as { authenticated?: boolean }
  return payload.authenticated === true
}

export async function loginWeb(key: string): Promise<void> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key })
  })
  if (!response.ok) {
    let message = '访问密钥错误'
    try { message = (await response.json() as { error?: string }).error || message } catch { /* use default */ }
    throw new Error(message)
  }
}

export async function loginRemote(baseUrl: string, key: string): Promise<string> {
  const root = baseUrl.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(root)) throw new Error('服务地址必须以 http:// 或 https:// 开头')
  const response = await fetch(`${root}/api/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key })
  })
  if (!response.ok) {
    let message = '访问密钥错误'
    try { message = (await response.json() as { error?: string }).error || message } catch { /* use default */ }
    throw new Error(message)
  }
  const payload = await response.json() as { token?: string }
  if (!payload.token) throw new Error('服务未返回有效会话')
  return payload.token
}
