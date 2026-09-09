import { lazy, Suspense, useEffect, useState } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './layouts/AppLayout'
import { WelcomePage } from './pages/welcome/WelcomePage'
import { WebLoginPage } from './pages/webLogin/WebLoginPage'
import { Spinner } from './components/ui/primitives'
import { checkWebSession } from './platform/webAuth'
import { isWebPlatform } from './platform/platformApi'
import { useChat } from './stores/chatStore'
import { useSettings } from './stores/settingsStore'
import { useWorkspace } from './stores/workspaceStore'

const ChaptersPage = lazy(() => import('./pages/chapters/ChaptersPage').then(({ ChaptersPage: page }) => ({ default: page })))
const CharactersPage = lazy(() => import('./pages/characters/CharactersPage').then(({ CharactersPage: page }) => ({ default: page })))
const ChatPage = lazy(() => import('./pages/chat/ChatPage').then(({ ChatPage: page }) => ({ default: page })))
const EventsPage = lazy(() => import('./pages/events/EventsPage').then(({ EventsPage: page }) => ({ default: page })))
const OutlinePage = lazy(() => import('./pages/outline/OutlinePage').then(({ OutlinePage: page }) => ({ default: page })))
const RelationsPage = lazy(() => import('./pages/relations/RelationsPage').then(({ RelationsPage: page }) => ({ default: page })))
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage').then(({ SettingsPage: page }) => ({ default: page })))
const SettingsDocsPage = lazy(() => import('./pages/settingsDocs/SettingsDocsPage').then(({ SettingsDocsPage: page }) => ({ default: page })))
const NotesPage = lazy(() => import('./pages/notes/NotesPage').then(({ NotesPage: page }) => ({ default: page })))
const UsagePage = lazy(() => import('./pages/usage/UsagePage').then(({ UsagePage: page }) => ({ default: page })))

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
    return bindEvents()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webAuthReady])

  useEffect(() => {
    if (status === 'ready') void initSessions()
  }, [status, initSessions])


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
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings-docs" element={<SettingsDocsPage />} />
            <Route path="/notes" element={<NotesPage />} />
            <Route path="/usage" element={<UsagePage />} />
            <Route path="*" element={<Navigate to="/chat" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </HashRouter>
  )
}
