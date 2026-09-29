/** 主进程入口：窗口生命周期 + 服务装配 */
import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'node:url'
import { AgentService } from './agent/agentLoop'
import { registerIpc, type AppContext } from './ipc'
import { IPC } from '../shared/ipc'
import type { AgentEventEnvelope } from '../shared/api'
import { MainRuntimeEvents } from './runtimeEvents'
import { AgentEventBridge } from './agentEventBridge'
import { SettingsService } from './services/settingsService'
import { UsageService } from '../core/usage/usageService'
import { isAllowedExternalUrl, isAllowedRendererNavigation } from './navigationPolicy'
import { NodeFileStore } from '../core/storage/nodeFileStore'
import { configureNetworkLogger, configureSystemProxy } from './networkFetch'
import { AppLogger } from './appLogger'

let agentBackgroundActivityActive = false
let appLogger: AppLogger | undefined

function reportProcessError(kind: string, error: unknown): void {
  console.error(`[storyfabric] ${kind}`, error)
  void appLogger?.error(kind, { error: error instanceof Error ? error.message : String(error) }).catch(() => {})
}

process.on('uncaughtException', (error) => reportProcessError('uncaught exception', error))
process.on('unhandledRejection', (reason) => reportProcessError('unhandled rejection', reason))

function resolveIconPath(): string {
  // 开发态取项目 resources/；打包后 extraResources 会把 icon.ico 放到 resources 根目录
  return app.isPackaged ? join(process.resourcesPath, 'icon.ico') : join(app.getAppPath(), 'resources', 'icon.ico')
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
  win.webContents.setBackgroundThrottling(!agentBackgroundActivityActive)

  win.on('ready-to-show', () => {
    win.show()
    win.focus()
    win.moveTop()
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (isAllowedRendererNavigation(url, rendererUrl)) return
    event.preventDefault()
    if (isAllowedExternalUrl(url)) void shell.openExternal(url)
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Keep the desktop shell recoverable when Chromium's renderer exits while a
  // long-running agent is still active. The main process remains alive so the
  // in-flight run can finish and the renderer can reconnect to its event log.
  win.webContents.on('render-process-gone', (_event, details) => {
    reportProcessError(`renderer exited (${details.reason})`, details.exitCode)
    if (details.reason !== 'clean-exit' && !win.isDestroyed()) {
      setTimeout(() => { if (!win.isDestroyed()) void win.webContents.reload() }, 250)
    }
  })
  win.on('unresponsive', () => reportProcessError('window unresponsive', new Error('renderer did not respond')))

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
      if (!win.isVisible()) win.show()
      win.focus()
      win.moveTop()
    }
  })

  app.whenReady().then(async () => {
    // 与 electron-builder appId 一致，保证任务栏分组/图标行为正确
    app.setAppUserModelId('com.storyfabric.app')
    const logger = new AppLogger({ directory: join(app.getPath('userData'), 'logs') })
    appLogger = logger
    configureNetworkLogger(logger)
    try {
      await logger.cleanup()
    } catch (error) {
      reportProcessError('log cleanup failed', error)
    }
    await logger.info('app.start', { version: app.getVersion(), platform: process.platform, arch: process.arch })
    const logCleanupTimer = setInterval(() => {
      void logger.cleanup().catch((error) => reportProcessError('log cleanup failed', error))
    }, 6 * 60 * 60 * 1000)
    logCleanupTimer.unref?.()
    try {
      await configureSystemProxy()
      void logger.info('network.proxy.configured', { mode: 'system' })
    } catch (error) {
      reportProcessError('system proxy setup failed', error)
    }
    const win = createWindow()

    const settings = new SettingsService(join(app.getPath('userData'), 'settings.json'))
    const usage = new UsageService(join(app.getPath('userData'), 'usage.json'))
    const runtimeEvents = new MainRuntimeEvents()
    const agentEventBridge = new AgentEventBridge((envelope, workspaceId) => {
      const runtimeEnvelope = envelope.runId && workspaceId
        ? runtimeEvents.append(workspaceId, envelope.sessionId, envelope.runId, envelope.event)
        : null
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC.AgentEvent, envelope)
        if (runtimeEnvelope) window.webContents.send(IPC.RuntimeAgentEvent, runtimeEnvelope)
      }
    })
    let quitFlushStarted = false
    app.on('before-quit', (event) => {
      if (quitFlushStarted) return
      quitFlushStarted = true
      event.preventDefault()
      clearInterval(logCleanupTimer)
      agentEventBridge.flush()
      void logger.flush().finally(() => app.quit())
    })

    const agent = new AgentService(
      settings,
      (sessionId, event, runId, workspaceId) => {
        const envelope: AgentEventEnvelope = { sessionId, ...(runId ? { runId } : {}), event }
        agentEventBridge.push(envelope, workspaceId)
      },
      (record) => void usage.append(record).catch(() => {}),
      new NodeFileStore(app.getPath('userData')),
      (active) => {
        agentBackgroundActivityActive = active
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) window.webContents.setBackgroundThrottling(!active)
        }
      }
    )

    const ctx: AppContext = { win: () => win, settings, agent, usage, runtimeEvents }
    registerIpc(ctx)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
