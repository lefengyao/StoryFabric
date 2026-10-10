import type { ReactNode } from 'react'

export function WorkspaceViewport({ children }: { children: ReactNode }): React.ReactElement {
  return <div className="workspace-viewport h-full min-h-0 min-w-0 overflow-hidden">{children}</div>
}
