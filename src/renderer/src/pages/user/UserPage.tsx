import { CheckCircle2, KeyRound, LogIn, RefreshCw, RotateCw, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getPlatformApi } from '../../platform/platformApi'
import { useSettings } from '../../stores/settingsStore'
import type { CloudAccountApi, CloudAccountConfig, CloudAccountState, CloudAccountSummary, CloudChannel, CloudSupplierGroup, CloudRedeem, CloudUsage } from '../../../../shared/cloudAccount'
import { SupplierLobby } from './SupplierLobby'
import { genId } from '../../../../core/workspace/entityStore'

const operationId = (): string => genId('sf')

const configSourceLabel: Record<CloudAccountConfig['source'], string> = {
  application: '应用设置',
  environment: '环境变量',
  none: '未配置'
}

/** Desktop-only account endpoint configuration. Web and Android bridges omit these optional methods. */
export function PlatformAccountConfig({ account, onUpdated }: { account: CloudAccountApi; onUpdated?: () => Promise<void> }): React.ReactElement | null {
  const getConfig = account.getConfig
  const setPlatformWebUrl = account.setPlatformWebUrl
  const configurable = typeof getConfig === 'function' && typeof setPlatformWebUrl === 'function'
  const [config, setConfig] = useState<CloudAccountConfig | null>(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(configurable)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!configurable || !getConfig) return
    let active = true
    setLoading(true)
    setError(null)
    void getConfig.call(account).then((next) => {
      if (!active) return
      setConfig(next)
      setDraft(next.platformWebUrl)
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : '读取账户服务配置失败')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [configurable, account, getConfig])

  if (!configurable || !account.setPlatformWebUrl) return null

  const save = async (): Promise<void> => {
    const value = draft.trim()
    if (!value) { setError('请输入 Platform 前端网址'); return }
    setBusy(true); setError(null)
    try {
      const next = await setPlatformWebUrl.call(account, value)
      setConfig(next); setDraft(next.platformWebUrl); await onUpdated?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存账户服务配置失败')
    } finally { setBusy(false) }
  }

  const clear = async (): Promise<void> => {
    if (config?.source !== 'application') return
    setBusy(true); setError(null)
    try {
      const next = await setPlatformWebUrl.call(account, null)
      setConfig(next); setDraft(next.platformWebUrl); await onUpdated?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '清除应用地址失败')
    } finally { setBusy(false) }
  }

  return (
    <section className="rounded-xl border border-border bg-panel p-5" aria-labelledby="platform-account-config-title">
      <div>
        <h2 id="platform-account-config-title" className="font-medium">账户服务地址</h2>
      <p className="mt-1 text-sm text-muted">填写 T-user-platform 前端网址，用于登录授权。Sub2API 资源接口继续使用部署配置的地址。</p>
      </div>
      <label htmlFor="platform-account-url" className="mt-4 block text-sm font-medium">Platform 前端网址</label>
      <input
        id="platform-account-url"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="https://accounts.example.com"
        inputMode="url"
        autoComplete="url"
        disabled={loading || busy}
        className="mt-2 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60"
      />
      <p className="mt-2 text-xs text-muted">当前来源：{configSourceLabel[config?.source ?? 'none']}。清除应用地址后会回退到环境变量配置。</p>
      <p className="mt-1 text-xs text-muted">Platform 与 Sub2API 的共享服务令牌属于服务端部署参数，不需要也不应填写到应用中。</p>
      {error && <p className="mt-2 text-sm text-red-700" role="alert">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button disabled={loading || busy} onClick={() => void save()} className="rounded-lg bg-accent px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? '保存中…' : '保存地址'}</button>
        <button disabled={loading || busy || config?.source !== 'application'} onClick={() => void clear()} className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50">清除应用地址</button>
      </div>
    </section>
  )
}

export function UserPage(): React.ReactElement {
  let account: ReturnType<typeof getPlatformApi>['cloudAccount']
  try { account = getPlatformApi().cloudAccount } catch { account = undefined }
  const [state, setState] = useState<CloudAccountState | null>(null)
  const [summary, setSummary] = useState<CloudAccountSummary | null>(null)
  const [lobby, setLobby] = useState<CloudSupplierGroup[]>([])
  const [groups, setGroups] = useState<CloudChannel[]>([])
  const [usage, setUsage] = useState<CloudUsage | null>(null)
  const [redeems, setRedeems] = useState<CloudRedeem[]>([])
  const [redeemCode, setRedeemCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reload = async (): Promise<void> => {
    if (!account) return
    try {
      const next = await account.getState()
      setState(next)
      setError(next.error || null)
      if (next.phase === 'signed-in') {
        const [a, g, l, u, h] = await Promise.all([account.getAccount(), account.getGroups(), account.getSupplierLobby?.() ?? Promise.resolve(null), account.getUsage(), account.getRedeemHistory()])
        setSummary(a); setGroups(g); setLobby(l ?? g.map(group => ({ ...group, models: [] }))); setUsage(u); setRedeems(h)
      }
    }
    catch (cause) {
      // A failed request can expire the session after the initial state read.
      // Read it again so retry shows the login action instead of a loading card.
      const current = await account.getState().catch(() => null)
      if (current) {
        setState(current)
        if (current.phase !== 'signed-in') {
          setSummary(null); setGroups([]); setLobby([]); setUsage(null); setRedeems([])
        }
      }
      setError(current?.error || (cause instanceof Error ? cause.message : '账户服务请求失败'))
    }
  }
  useEffect(() => { void reload() }, [])
  useEffect(() => {
    if (!state) return
    void useSettings.getState().load().catch(() => undefined)
  }, [state?.phase, summary?.connection.configurationVersion, summary?.connection.group?.id])
  useEffect(() => {
    if (!account || !state || !['authorizing', 'provisioning'].includes(state.phase)) return
    const timer = window.setInterval(() => { void reload() }, 1000)
    return () => window.clearInterval(timer)
  }, [account, state?.phase])
  const login = async (): Promise<void> => { if (!account) return; setBusy(true); setError(null); try { setState(await account.beginLogin()); await reload() } catch (cause) { setError(cause instanceof Error ? cause.message : '登录失败') } finally { setBusy(false) } }
  const logout = async (): Promise<void> => { if (!account) return; setBusy(true); try { setState(await account.logout()); setSummary(null) } catch (cause) { setError(cause instanceof Error ? cause.message : '退出失败') } finally { setBusy(false) } }
  const rotate = async (): Promise<void> => { if (!account || !summary) return; setBusy(true); try { await account.rotateConnection({ expectedCredentialVersion: summary.connection.credentialVersion, operationId: operationId() }); await reload() } catch (cause) { setError(cause instanceof Error ? cause.message : '连接轮换失败') } finally { setBusy(false) } }
  const selectGroup = async (groupId: string): Promise<void> => { if (!account || !summary) return; setBusy(true); try { await account.selectGroup({ groupId, expectedCredentialVersion: summary.connection.credentialVersion, operationId: operationId() }); await reload() } catch (cause) { setError(cause instanceof Error ? cause.message : '分组切换失败') } finally { setBusy(false) } }
  const redeem = async (): Promise<void> => { if (!account || !redeemCode.trim()) return; setRedeeming(true); setError(null); try { await account.redeem({ code: redeemCode.trim(), operationId: operationId() }); setRedeemCode(''); await reload() } catch (cause) { setError(cause instanceof Error ? cause.message : '兑换失败') } finally { setRedeeming(false) } }
  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-5 overflow-y-auto p-5 sm:p-8">
      <div>
        <div className="flex items-center gap-2"><UserRound size={22} className="text-accent" /><h1 className="font-serif text-xl font-semibold">用户</h1></div>
        <p className="mt-1 text-sm text-muted">使用你的 Trailblazer 账号连接云端聚合服务。</p>
      </div>
      {error && <div className="rounded-lg border border-red-300/40 bg-red-500/10 p-3 text-sm text-red-700">{error}<button className="ml-3 underline" onClick={() => void reload()}>重试</button></div>}
      {(!account || !state || state.phase === 'signed-out') && <section className="rounded-xl border border-border bg-panel p-5"><div className="flex items-center gap-3"><KeyRound size={22} className="text-accent" /><div><h2 className="font-medium">登录你的 Trailblazer 账号</h2><p className="mt-1 text-sm text-muted">密码和邮箱验证在账户中心完成。StoryFabric 不显示 API Key。</p></div></div>{account ? <button disabled={busy} onClick={() => void login()} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"><LogIn size={16} />{busy ? '正在打开…' : '登录 / 注册'}</button> : <><button disabled className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm text-white opacity-50"><LogIn size={16} />登录 / 注册</button><p className="mt-2 text-sm text-muted">Trailblazer 账户服务未配置，请联系管理员完成部署配置。</p></>}</section>}
      {state?.phase === 'unconfigured' && <section className="rounded-xl border border-border bg-panel p-5"><div className="flex items-center gap-3"><KeyRound size={22} className="text-accent" /><div><h2 className="font-medium">Trailblazer 账户服务未配置</h2><p className="mt-1 text-sm text-muted">当前部署尚未连接账户中心，请联系管理员完成部署配置。</p></div></div><button disabled className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm text-white opacity-50"><LogIn size={16} />登录 / 注册</button></section>}
      {state?.phase === 'authorizing' && <section className="rounded-xl border border-border bg-panel p-5"><p className="text-sm">已打开账户授权页面，完成后返回此应用。页面会自动检查登录结果。</p><button className="mt-3 rounded-lg border border-border px-3 py-2 text-sm" onClick={() => { void account?.cancelLogin().then(setState) }}>取消</button></section>}
      {state?.phase === 'provisioning' && <section className="rounded-xl border border-border bg-panel p-5"><p className="text-sm">正在连接你的云端账户并准备托管连接…</p><button disabled={busy} className="mt-3 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50" onClick={() => { if (!account) return; setBusy(true); void account.retryOnboarding().then(() => reload()).catch((cause) => setError(cause instanceof Error ? cause.message : '账户连接失败')).finally(() => setBusy(false)) }}>重试连接</button></section>}
      {state?.phase === 'signed-in' && !summary && <section className="rounded-xl border border-border bg-panel p-5"><p className="text-sm">正在加载账户信息…</p></section>}
      {state?.phase === 'signed-in' && summary && <>
        <section className="rounded-xl border border-border bg-panel p-5"><div className="flex items-center justify-between"><div><h2 className="font-medium">{state.identity?.name || state.identity?.email || 'Trailblazer 用户'}</h2><p className="mt-1 text-xs text-muted">{state.identity?.email || state.identity?.subject}</p></div><CheckCircle2 size={20} className="text-emerald-600" /></div><div className="mt-4 grid gap-3 sm:grid-cols-3"><div><p className="text-xs text-muted">云端余额</p><p className="text-lg font-semibold">{summary.balance.amount} {summary.balance.currency}</p></div><div><p className="text-xs text-muted">当前分组</p><p className="text-sm">{summary.connection.group?.name || '未选择'}</p></div><div><p className="text-xs text-muted">连接状态</p><p className="text-sm">{summary.connection.status}</p></div></div><div className="mt-4 flex flex-wrap gap-2"><button disabled={busy} onClick={() => void rotate()} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"><RotateCw size={15} />更换托管连接</button><button disabled={busy} onClick={() => void logout()} className="rounded-lg border border-border px-3 py-2 text-sm">退出登录</button></div></section>
        <section className="rounded-xl border border-border bg-panel p-5"><h2 className="font-medium">选择分组</h2><p className="mt-1 text-sm text-muted">分组按你的账号权限提供，切换后官方供应商会使用该分组的托管连接。</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{groups.map((group) => { const selected = summary.connection.group?.id === group.id; return <button key={group.id} type="button" aria-pressed={selected} disabled={busy || selected} onClick={() => void selectGroup(group.id)} className={`rounded-lg border px-3 py-3 text-left text-sm transition-colors disabled:opacity-60 ${selected ? 'border-accent bg-accent-soft' : 'border-border hover:border-accent'}`}><span className="font-medium">{group.name}</span>{selected && <span className="ml-2 text-xs text-accent">当前</span>}</button> })}</div>{groups.length === 0 && <p className="mt-2 text-sm text-muted">当前没有可切换的分组。</p>}</section>
        <SupplierLobby groups={lobby} />
        <section className="rounded-xl border border-border bg-panel p-5"><div className="flex items-center justify-between"><h2 className="font-medium">云端用量</h2><button onClick={() => void reload()} className="text-muted hover:text-foreground"><RefreshCw size={16} /></button></div><p className="mt-2 text-sm text-muted">共 {usage?.total ?? 0} 条记录，本页 {usage?.items.length ?? 0} 条。余额和用量来自 Sub2API。</p></section>
        <section className="rounded-xl border border-border bg-panel p-5"><h2 className="font-medium">兑换额度</h2><p className="mt-1 text-sm text-muted">输入管理员发放的兑换码。当前页面不提供在线充值。</p><div className="mt-3 flex flex-col gap-2 sm:flex-row"><input value={redeemCode} onChange={(event) => setRedeemCode(event.target.value)} placeholder="兑换码" maxLength={256} className="min-w-0 flex-1 rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent" /><button disabled={redeeming || !redeemCode.trim()} onClick={() => void redeem()} className="rounded-lg bg-accent px-4 py-2 text-sm text-white disabled:opacity-50">{redeeming ? '兑换中…' : '兑换'}</button></div>{redeems.length > 0 && <div className="mt-4 space-y-2 text-sm text-muted"><p className="font-medium text-foreground">最近兑换</p>{redeems.slice(0, 5).map((item, index) => <div key={String(item.id ?? index)} className="flex justify-between border-t border-border pt-2"><span>{item.type || '额度'}</span><span>{item.amount ?? '-'}{item.createdAt ? ` · ${new Date(item.createdAt).toLocaleDateString()}` : ''}</span></div>)}</div>}</section>
      </>}
      <p className="text-sm text-muted">全局记忆和项目记忆已统一放在<Link to="/memory" className="ml-1 text-accent hover:underline">记忆页面</Link>管理。</p>
    </div>
  )
}

export default UserPage
