import { lazy, Suspense, useEffect, useState } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './layouts/AppLayout'
import { WelcomePage } from './pages/welcome/WelcomePage'
import { WebLoginPage } from './pages/webLogin/WebLoginPage'
import { Spinner } from './components/ui/primitives'
import { checkWebSession } from './platform/webAuth'
import { getPlatformApi, isWebPlatform } from './platform/platformApi'
import { useChat } from './stores/chatStore'
import { recoverActiveRun, useRunStore } from './stores/runStore'
import { useSettings } from './stores/settingsStore'
import { useWorkspace } from './stores/workspaceStore'

const ChaptersPage = lazy(() => import('./pages/chapters/ChaptersPage').then(({ ChaptersPage: page }) => ({ default: page })))
const CharactersPage = lazy(() => import('./pages/characters/CharactersPage').then(({ CharactersPage: page }) => ({ default: page })))
const ChatPage = lazy(() => import('./pages/chat/ChatPage').then(({ ChatPage: page }) => ({ default: page })))
const EventsPage = lazy(() => import('./pages/events/EventsPage').then(({ EventsPage: page }) => ({ default: page })))
const OutlinePage = lazy(() => import('./pages/outline/OutlinePage').then(({ OutlinePage: page }) => ({ default: page })))
const RelationsPage = lazy(() => import('./pages/relations/RelationsPage').then(({ RelationsPage: page }) => ({ default: page })))
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage').then(({ SettingsPage: page }) => ({ default: page })))
const CreativePage = lazy(() => import('./pages/creative/CreativePage').then(({ CreativePage: page }) => ({ default: page })))
const InspirationPage = lazy(() => import('./pages/inspiration/InspirationPage').then(({ InspirationPage: page }) => ({ default: page })))
const SettingsDocsPage = lazy(() => import('./pages/settingsDocs/SettingsDocsPage').then(({ SettingsDocsPage: page }) => ({ default: page })))
const NotesPage = lazy(() => import('./pages/notes/NotesPage').then(({ NotesPage: page }) => ({ default: page })))
const UsagePage = lazy(() => import('./pages/usage/UsagePage').then(({ UsagePage: page }) => ({ default: page })))
const GoalsPage = lazy(() => import('./pages/goals/GoalsPage').then(({ GoalsPage: page }) => ({ default: page })))
const UserPage = lazy(() => import('./pages/user/UserPage').then(({ UserPage: page }) => ({ default: page })))
const MemoryPage = lazy(() => import('./pages/memory/MemoryPage').then(({ MemoryPage: page }) => ({ default: page })))

export default function App(): React.ReactElement {
  const web = isWebPlatform()
  const [webAuthReady, setWebAuthReady] = useState(!web)
  const [webAuthChecked, setWebAuthChecked] = useState(!web)
  const [webAuthError, setWebAuthError] = useState<string | null>(null)
  const status = useWorkspace((s) => s.status)
  const initWorkspace = useWorkspace((s) => s.init)
  const loadSettings = useSettings((s) => s.load)
  const bindEvents = useChat((s) => s.bindEvents)
  const initSessions = useChat((s) => s.initSessions)
  const resetChatWorkspace = useChat((s) => s.resetWorkspace)
  const workspacePath = useWorkspace((s) => s.summary?.path ?? null)
  const workspaceSource = useWorkspace((s) => s.uiSource)

  useEffect(() => {
    if (!web) return
    void checkWebSession().then((authenticated) => {
      setWebAuthReady(authenticated)
      setWebAuthChecked(true)
    }).catch((error) => {
      setWebAuthError(error instanceof Error ? error.message : String(error))
      setWebAuthChecked(true)
    })
  }, [web])

  useEffect(() => {
    if (!webAuthReady) return
    void initWorkspace()
    void loadSettings()
    const platform = getPlatformApi()
    const unbindAgentEvents = bindEvents()
    const unbindRuntimeEvents = platform.onRuntimeAgentEvent?.((envelope) => useRunStore.getState().applyEvent(envelope))
    const recover = (): void => {
      if (document.visibilityState === 'hidden') return
      void recoverActiveRun(platform).catch(() => undefined)
    }
    window.addEventListener('focus', recover)
    document.addEventListener('visibilitychange', recover)
    recover()
    return () => {
      unbindAgentEvents()
      unbindRuntimeEvents?.()
      window.removeEventListener('focus', recover)
      document.removeEventListener('visibilitychange', recover)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webAuthReady])

  useEffect(() => {
    if (status !== 'ready') return
    useRunStore.getState().clear()
    resetChatWorkspace()
    void initSessions()
  }, [status, workspacePath, workspaceSource, initSessions, resetChatWorkspace])


  if (web && !webAuthChecked) {
    return <div className="flex h-full items-center justify-center"><Spinner /></div>
  }
  if (web && webAuthError) {
    return <div className="flex h-full items-center justify-center p-6 text-sm text-danger">{webAuthError}</div>
  }
  if (web && !webAuthReady) {
    return <WebLoginPage onAuthenticated={() => { setWebAuthReady(true); setWebAuthError(null) }} />
  }
  if (status === 'booting') {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  }
  if (status === 'empty') return <WelcomePage />

  return (
    <HashRouter>
      <Suspense fallback={<div className="flex h-full items-center justify-center"><Spinner /></div>}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/characters" element={<CharactersPage />} />
            <Route path="/relations" element={<RelationsPage />} />
            <Route path="/outline" element={<OutlinePage />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/chapters" element={<ChaptersPage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/creative" element={<CreativePage />} />
            <Route path="/inspiration" element={<InspirationPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings-docs" element={<SettingsDocsPage />} />
            <Route path="/notes" element={<NotesPage />} />
            <Route path="/usage" element={<UsagePage />} />
            <Route path="/goals" element={<GoalsPage />} />
            <Route path="/user" element={<UserPage />} />
            <Route path="/memory" element={<MemoryPage />} />
            <Route path="*" element={<Navigate to="/chat" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </HashRouter>
  )
}
