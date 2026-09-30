import { useSearchParams } from 'react-router-dom'
import { CreativeExtensionsView } from '../settings/CreativeExtensionsView'
import { RuleSetEditor } from '../settings/RuleSetEditor'

const TABS = [
  { key: 'skills', label: 'Skill 与插件' },
  { key: 'rules', label: '自定义规则集' }
] as const

type CreativeTab = (typeof TABS)[number]['key']

/** Global creative resources deliberately live outside workspace entities and chat settings. */
export function CreativePage(): React.ReactElement {
  const [params, setParams] = useSearchParams()
  const active = TABS.find((tab) => tab.key === params.get('tab'))?.key ?? 'skills'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div data-android-tab-strip className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-4 py-2" role="tablist" aria-label="创作资源">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active === tab.key}
            onClick={() => setParams({ tab: tab.key })}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs transition-colors ${
              active === tab.key ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-elevated hover:text-fg'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div data-scroll-region="creative-page-content" className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 p-6">
          {active === 'skills' && <CreativeExtensionsView />}
          {active === 'rules' && <RuleSetEditor />}
        </div>
      </div>
    </div>
  )
}

export type { CreativeTab }
