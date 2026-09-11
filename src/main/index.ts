/** 主进程入口：窗口生命周期 + 服务装配 */
import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'node:url'
import { AgentService } from './agent/agentLoop'
import { registerIpc, type AppContext } from './ipc'
import { IPC } from '../shared/ipc'
import type { AgentEventEnvelope } from '../shared/api'
import { SettingsService } from './services/settingsService'
import { UsageService } from '../core/usage/usageService'
import { DeployService } from './services/deployService'
import { DeployTargetsStore } from './services/deployTargetsStore'
import { Ssh2Transport } from './services/ssh2Transport'
import { isAllowedExternalUrl, isAllowedRendererNavigation } from './navigationPolicy'

function resolveIconPath(): string {
  // 开发态取项目 resources/；打包后 extraResources 会把 icon.ico 放到 resources 根目录
  return app.isPackaged ? join(process.resourcesPath, 'icon.ico') : join(app.getAppPath(), 'resources', 'icon.ico')
}

function resolveServerBundlePath(): string {
  // 打包后由 extraResources 放到 resources 根目录；开发态用当前版本目录里的包，便于本地联调
  return app.isPackaged
    ? join(process.resourcesPath, 'server-bundle.tar.gz')
    : join(app.getAppPath(), 'release', app.getVersion(), `storyfabric-server-${app.getVersion()}.tar.gz`)
}

function createWindow(): BrowserWindow {
  const rendererFile = join(__dirname, '../renderer/index.html')
  const rendererUrl = process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(rendererFile).toString()
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#fafafa',
    title: '织章 · StoryFabric',
    icon: resolveIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.on('will-navigate', (event, url) => {
    if (isAllowedRendererNavigation(url, rendererUrl)) return
    event.preventDefault()
    if (isAllowedExternalUrl(url)) void shell.openExternal(url)
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(rendererFile)
  }
  return win
}

// 单实例锁：避免多开同时写同一份 userData（设置/密钥）
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    // 与 electron-builder appId 一致，保证任务栏分组/图标行为正确
    app.setAppUserModelId('com.storyfabric.app')
    const win = createWindow()

    const settings = new SettingsService(join(app.getPath('userData'), 'settings.json'))
    const usage = new UsageService(join(app.getPath('userData'), 'usage.json'))
    const deploy = new DeployService({
      store: new DeployTargetsStore(join(app.getPath('userData'), 'deploy-targets.json')),
      createTransport: () => new Ssh2Transport(),
      bundlePath: resolveServerBundlePath(),
      version: app.getVersion()
    })

    const agent = new AgentService(
      settings,
      (sessionId, event) => {
        const envelope: AgentEventEnvelope = { sessionId, event }
        for (const w of BrowserWindow.getAllWindows()) {
          w.webContents.send(IPC.AgentEvent, envelope)
        }
      },
      (record) => void usage.append(record).catch(() => {})
    )

    const ctx: AppContext = { win: () => win, settings, agent, usage, deploy }
    registerIpc(ctx)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
