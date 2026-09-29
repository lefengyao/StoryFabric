import { Brain } from 'lucide-react'
import { MemoryScopeEditor } from './MemoryScopeEditor'

export function MemoryPage(): React.ReactElement {
  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-5 overflow-y-auto p-5 sm:p-8">
      <div>
        <div className="flex items-center gap-2"><Brain size={22} className="text-accent" /><h1 className="font-serif text-xl font-semibold">记忆</h1></div>
        <p className="mt-1 text-sm text-muted">管理当前项目专用的记忆。切换项目后，这里的内容会跟随当前项目变化。</p>
      </div>
      <MemoryScopeEditor scope="project" title="当前项目记忆" description="适合本项目的叙事规则、世界观约束和只对当前作品生效的协作偏好。内容保存在项目内，并随项目备份一起导出。" />
    </div>
  )
}

export default MemoryPage
