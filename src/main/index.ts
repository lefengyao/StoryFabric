/** 主进程入口：窗口生命周期 + 服务装配 */
import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { AgentService } from './agent/agentLoop'
import { registerIpc, type AppContext } from './ipc'
import { IPC } from '../shared/ipc'
import type { AgentEventEnvelope } from '../shared/api'
import { SettingsService } from './services/settingsService'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#fafafa',
    title: 'StoryFabric',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

app.whenReady().then(() => {
  const win = createWindow()

  const settings = new SettingsService(join(app.getPath('userData'), 'settings.json'))

  const agent = new AgentService(settings, (sessionId, event) => {
    const envelope: AgentEventEnvelope = { sessionId, event }
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(IPC.AgentEvent, envelope)
    }
  })

  const ctx: AppContext = { win: () => win, settings, agent }
  registerIpc(ctx)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
