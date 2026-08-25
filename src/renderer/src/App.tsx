import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './layouts/AppLayout'
import { ChaptersPage } from './pages/chapters/ChaptersPage'
import { CharactersPage } from './pages/characters/CharactersPage'
import { ChatPage } from './pages/chat/ChatPage'
import { EventsPage } from './pages/events/EventsPage'
import { OutlinePage } from './pages/outline/OutlinePage'
import { RelationsPage } from './pages/relations/RelationsPage'
import { SettingsPage } from './pages/settings/SettingsPage'
import { WelcomePage } from './pages/welcome/WelcomePage'
import { Spinner } from './components/ui/primitives'
import { useChat } from './stores/chatStore'
import { useSettings } from './stores/settingsStore'
import { useWorkspace } from './stores/workspaceStore'

export default function App(): React.ReactElement {
  const status = useWorkspace((s) => s.status)
  const initWorkspace = useWorkspace((s) => s.init)
  const loadSettings = useSettings((s) => s.load)
  const bindEvents = useChat((s) => s.bindEvents)

  useEffect(() => {
    void initWorkspace()
    void loadSettings()
    return bindEvents()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


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
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/characters" element={<CharactersPage />} />
          <Route path="/relations" element={<RelationsPage />} />
          <Route path="/outline" element={<OutlinePage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/chapters" element={<ChaptersPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
