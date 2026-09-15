import { useEffect, useState, type ReactNode } from 'react'
import { LandscapeGate } from './LandscapeGate'
import { requestLandscapeLock } from '../../platform/orientation'

export function WorkspaceViewport({ children }: { children: ReactNode }): React.ReactElement {
  const [portrait, setPortrait] = useState(false)
  const [usePcFallback, setUsePcFallback] = useState(false)
  useEffect(() => {
    const update = (): void => setPortrait(window.innerHeight > window.innerWidth)
    update()
    window.addEventListener('resize', update)
    void requestLandscapeLock()
    return () => window.removeEventListener('resize', update)
  }, [])
  return <div className="workspace-viewport h-full min-h-0 min-w-[1100px] overflow-x-auto overflow-y-hidden"><LandscapeGate visible={portrait && !usePcFallback} onUsePc={() => setUsePcFallback(true)}>{children}</LandscapeGate></div>
}
