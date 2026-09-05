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
