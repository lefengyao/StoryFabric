import { Brain } from 'lucide-react'
import { MemoryScopeEditor } from './MemoryScopeEditor'

export function MemoryPage(): React.ReactElement {
  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-5 overflow-y-auto p-5 sm:p-8">
      <div>
        <div className="flex items-center gap-2"><Brain size={22} className="text-accent" /><h1 className="font-serif text-xl font-semibold">记忆</h1></div>
        <p className="mt-1 text-sm text-muted">在这里管理跨项目通用的全局记忆，以及随当前项目变化的项目记忆。</p>
      </div>
      <MemoryScopeEditor scope="global" title="全局记忆" description="适合稳定的写作习惯、回答偏好和长期协作规则。内容保存在本设备的应用数据中，不随单个项目导出。" />
      <MemoryScopeEditor scope="project" title="当前项目记忆" description="适合本项目的叙事规则、世界观约束和只对当前作品生效的协作偏好。内容保存在项目内，并随项目备份一起导出。" />
    </div>
  )
}

export default MemoryPage
