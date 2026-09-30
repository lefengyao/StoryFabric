import { UserRound } from 'lucide-react'
import { Link } from 'react-router-dom'

export function UserPage(): React.ReactElement {
  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-5 overflow-y-auto p-5 sm:p-8">
      <div>
        <div className="flex items-center gap-2"><UserRound size={22} className="text-accent" /><h1 className="font-serif text-xl font-semibold">用户</h1></div>
        <p className="mt-1 text-sm text-muted">用户功能正在开发中。</p>
      </div>
      <p className="text-sm text-muted">全局记忆和项目记忆已统一放在<Link to="/memory" className="ml-1 text-accent hover:underline">记忆页面</Link>管理。</p>
    </div>
  )
}

export default UserPage
