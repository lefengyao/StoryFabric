import { KeyRound, LockKeyhole } from 'lucide-react'
import { useState } from 'react'
import { AppLogo } from '../../components/icons/AppLogo'
import { Button, Card, Input } from '../../components/ui/primitives'
import { loginWeb } from '../../platform/webAuth'

export function WebLoginPage({ onAuthenticated }: { onAuthenticated: () => void }): React.ReactElement {
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (!key.trim()) return
    setBusy(true)
    setError(null)
    try {
      await loginWeb(key)
      onAuthenticated()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-app p-4 sm:p-8">
      <Card className="w-full max-w-sm p-6 shadow-sm">
        <div className="mb-6 text-center">
          <AppLogo size={52} className="mx-auto mb-4 rounded-[12px]" />
          <h1 className="text-xl font-semibold">织章服务器</h1>
          <p className="mt-2 text-sm text-muted">输入访问密钥继续</p>
        </div>
        <div className="space-y-3">
          <label className="relative block">
            <KeyRound size={15} className="pointer-events-none absolute left-3 top-3 text-faint" />
            <Input
              type="password"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void submit() }}
              placeholder="访问密钥"
              autoFocus
              className="pl-9"
            />
          </label>
          {error && <div className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</div>}
          <Button variant="primary" className="w-full justify-center" onClick={() => void submit()} loading={busy} disabled={!key.trim()}>
            <LockKeyhole size={15} /> 登录
          </Button>
        </div>
      </Card>
    </div>
  )
}
