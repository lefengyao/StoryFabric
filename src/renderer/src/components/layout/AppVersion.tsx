import { APP_VERSION } from '../../lib/appVersion'
import { useAppUpdates } from '../../stores/appUpdateStore'

export function AppVersion({ className = '' }: { className?: string }): React.ReactElement {
  const available = useAppUpdates((s) => s.result?.status === 'available')
  return <span className={`shrink-0 whitespace-nowrap text-[10px] font-normal tabular-nums text-muted ${className}`} title={`StoryFabric v${APP_VERSION}${available ? ' · 有新版本，请前往设置中的监测更新' : ''}`} aria-label={`StoryFabric 版本 ${APP_VERSION}${available ? '，有更新' : ''}`}>v{APP_VERSION}{available && <span className="ml-1.5 text-accent">有更新</span>}</span>
}
