import { UserRound } from 'lucide-react'
import { MemoryScopeEditor } from '../memory/MemoryScopeEditor'

export function UserPage(): React.ReactElement {
  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-5 overflow-y-auto p-5 sm:p-8">
      <div>
        <div className="flex items-center gap-2"><UserRound size={22} className="text-accent" /><h1 className="font-serif text-xl font-semibold">用户</h1></div>
        <p className="mt-1 text-sm text-muted">管理跨项目通用的个人偏好。这里的内容保存在本设备的应用数据中，不随单个项目导出。</p>
      </div>
      <MemoryScopeEditor scope="global" title="用户偏好" description="适合稳定的写作习惯、回答偏好和长期协作规则。" />
    </div>
  )
}

export default UserPage
