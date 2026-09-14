import type { ReactNode } from 'react'

export function LandscapeGate({ children, visible, onUsePc }: { children: ReactNode; visible: boolean; onUsePc?: () => void }): React.ReactElement {
  return (
    <>
      {children}
      {visible && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-app/95 p-6 text-center backdrop-blur-sm">
          <div className="max-w-sm rounded-2xl border border-line bg-panel p-6 shadow-xl">
            <h2 className="font-serif text-lg font-semibold">请横屏使用工作台</h2>
            <p className="mt-2 text-sm text-muted">StoryFabric 保持 PC 横向工作台布局。旋转设备后即可继续；运行中的任务仍可停止。</p>
            {onUsePc && <button type="button" onClick={onUsePc} className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm text-accent-fg">使用横向工作台</button>}
          </div>
        </div>
      )}
    </>
  )
}
