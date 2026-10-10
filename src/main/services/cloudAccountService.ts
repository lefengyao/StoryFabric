import { createServer } from 'node:http'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { shell, safeStorage } from 'electron'
import { CloudAccountService, type AuthorizationLauncher, type CloudAccountLogger } from '../../core/cloud/cloudAccountService'
import { cloudConfigFromEnv, cloudConfigFromPlatformWebUrl, DEFAULT_PLATFORM_WEB_URL, DEFAULT_TRAILBLAZER_API_URL, type CloudConfig } from '../../core/cloud/oidcClient'
import { EncryptedCloudCredentialStore } from './cloudCredentialStore'
import { electronFetch } from '../networkFetch'
export function loopbackLauncher(
  openBrowser: (url: string) => Promise<void> = (url) => shell.openExternal(url),
  onCallback?: (success: boolean) => void,
  logger?: CloudAccountLogger
): AuthorizationLauncher {
  return { async launch(callback, cancelled) {
    let closed = false; let consumed = false
    const server = createServer((req, res) => {
      const address = server.address()
      if (!address || typeof address === 'string') { res.writeHead(400); res.end(); return }
      const url = new URL(req.url || '/', `http://127.0.0.1:${address.port}`)
      if (req.method !== 'GET' || url.pathname !== '/oauth/callback' || consumed) { res.writeHead(404); res.end(); return }
      consumed = true
      log(logger, 'info', 'cloud.oauth.callback-received', { path: url.pathname, hasCode: url.searchParams.has('code'), hasError: url.searchParams.has('error'), hasState: url.searchParams.has('state') })
      void callback(url).then(() => {
        onCallback?.(true)
        log(logger, 'info', 'cloud.oauth.callback-complete')
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end('<!doctype html><meta charset="utf-8"><title>登录完成</title><p>登录完成，请返回 StoryFabric。</p><script>window.close()</script>')
      }).catch(() => {
        onCallback?.(false)
        log(logger, 'error', 'cloud.oauth.callback-failed')
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end('<!doctype html><meta charset="utf-8"><title>登录未完成</title><p>登录未完成，请返回 StoryFabric 查看错误并重试。</p>')
      }).finally(close)
    })
    const timer = setTimeout(() => { log(logger, 'warn', 'cloud.oauth.listener-timeout'); close(); cancelled() }, 600_000); timer.unref()
    function close(): void { if (closed) return; closed = true; clearTimeout(timer); server.close() }
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()) })
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('回调监听器不可用')
    log(logger, 'info', 'cloud.oauth.listener-ready', { port: address.port })
    return { redirectUri: `http://127.0.0.1:${address.port}/oauth/callback`, open: openBrowser, close }
  } }
}
const CONFIG_VERSION = 1
type StoredConfig = { version: number; platformWebUrl: string }

async function writePlatformWebUrl(configPath: string, value: string | null): Promise<void> {
  if (!value) {
    await fs.rm(configPath, { force: true })
    return
  }
  await fs.mkdir(dirname(configPath), { recursive: true })
  const temporaryPath = `${configPath}.tmp-${process.pid}`
  await fs.writeFile(temporaryPath, `${JSON.stringify({ version: CONFIG_VERSION, platformWebUrl: value }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await fs.rename(temporaryPath, configPath)
}

export function createDesktopCloudAccountService(filePath: string, configPath = join(dirname(filePath), 'trailblazer-config.json'), onCallback?: (success: boolean) => void, logger?: CloudAccountLogger): CloudAccountService {
  let fallbackConfig: CloudConfig | undefined
  try { fallbackConfig = cloudConfigFromEnv() } catch { fallbackConfig = undefined }
  // The packaged desktop client uses the production account center directly.
  // Keep an independently deployed Sub2API resource URL when one is supplied.
  const config = cloudConfigFromPlatformWebUrl(DEFAULT_PLATFORM_WEB_URL, fallbackConfig?.resourceBaseUrl || DEFAULT_TRAILBLAZER_API_URL)
  return new CloudAccountService(config, new EncryptedCloudCredentialStore(filePath, safeStorage), loopbackLauncher(undefined, onCallback, logger), electronFetch, undefined, {
    configSource: 'application',
    fallbackConfig,
    persistPlatformWebUrl: (value) => writePlatformWebUrl(configPath, value),
    logger
  })
}

function log(logger: CloudAccountLogger | undefined, level: 'info' | 'warn' | 'error', event: string, details?: Record<string, unknown>): void {
  const writer = logger?.[level]
  if (!writer) return
  void Promise.resolve(writer.call(logger, event, details)).catch(() => undefined)
}
