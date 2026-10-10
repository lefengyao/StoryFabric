import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { checkForUpdates, type UpdateCheckResult, type UpdateDownloadState, type UpdatePlatform, type UpdatePreferences } from '../../shared/updates'

/** Download URLs come exclusively from a checked release, never from renderer IPC arguments. */
export class AppUpdateService {
  private result: UpdateCheckResult | null = null
  private downloadState: UpdateDownloadState = { status: 'idle', receivedBytes: 0, totalBytes: null }
  private controller: AbortController | null = null
  private readyFile: { path: string; hash: string } | null = null
  private installing = false
  constructor(private readonly options: {
    directory: string
    currentVersion: string
    platform: UpdatePlatform
    preferences: () => Promise<UpdatePreferences | undefined>
    fetchImpl: typeof fetch
    launch: (path: string) => Promise<string>
    /** Delay before deleting a successfully launched installer (overridable for tests). */
    cleanupDelayMs?: number
    /** Retry interval while Windows still holds the installer executable open. */
    cleanupRetryDelayMs?: number
    cleanupAttempts?: number
  }) {}

  async check(): Promise<UpdateCheckResult> {
    this.result = await checkForUpdates({ currentVersion: this.options.currentVersion, platform: this.options.platform, preferences: await this.options.preferences(), fetchImpl: this.options.fetchImpl })
    return this.result
  }
  state(): UpdateDownloadState { return { ...this.downloadState } }
  download(): UpdateDownloadState {
    if (this.controller || this.installing) return this.state()
    const result = this.result
    if (this.options.platform !== 'windows' || result?.status !== 'available' || !result.asset?.sha256) throw new Error('当前没有可以校验的 Windows 更新包，请先检查更新')
    const controller = new AbortController()
    this.controller = controller
    this.readyFile = null
    this.downloadState = { status: 'downloading', receivedBytes: 0, totalBytes: result.asset.bytes, version: result.latestVersion }
    void this.transfer(result, controller).finally(() => { this.controller = null })
    return this.state()
  }
  cancel(): UpdateDownloadState { this.controller?.abort(); return this.state() }

  private async transfer(result: UpdateCheckResult, controller: AbortController): Promise<void> {
    const asset = result.asset!
    // A generated filename keeps all filesystem writes inside our private update directory.
    const destination = join(this.options.directory, `StoryFabric-Setup-${result.latestVersion}.exe`)
    const partial = `${destination}.part`
    let file: Awaited<ReturnType<typeof fs.open>> | undefined
    let failure: string | undefined
    const timer = setTimeout(() => controller.abort(), 30 * 60_000)
    timer.unref?.()
    try {
      await fs.mkdir(this.options.directory, { recursive: true })
      const response = await this.options.fetchImpl(asset.url, { signal: controller.signal, cache: 'no-store' })
      if (!response.ok || !response.body || /text\/html|application\/json/i.test(response.headers.get('content-type') ?? '')) throw new Error('更新文件已不可用，请重新检查更新')
      file = await fs.open(partial, 'w')
      const hash = createHash('sha256')
      const reader = response.body.getReader()
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          if (controller.signal.aborted) throw new Error('下载已取消')
          this.downloadState.receivedBytes += value.byteLength
          if (this.downloadState.receivedBytes > (asset.bytes ?? 2 * 1024 ** 3)) throw new Error('更新文件体积不符合清单')
          hash.update(value)
          // FileHandle.write may make partial progress; writeFile handles the entire chunk.
          await file.writeFile(value)
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
      if (controller.signal.aborted) throw new Error('下载已取消')
      if ((asset.bytes !== null && this.downloadState.receivedBytes !== asset.bytes) || hash.digest('hex') !== asset.sha256) throw new Error('更新文件校验失败，请重新下载')
      await file.close(); file = undefined
      await fs.rename(partial, destination)
      this.readyFile = { path: destination, hash: asset.sha256! }
      this.downloadState.status = 'ready'
    } catch (error) {
      failure = controller.signal.aborted ? '下载已取消或超时，可以重新下载' : error instanceof Error ? error.message : '下载失败，请重试'
    } finally {
      clearTimeout(timer)
      await file?.close().catch(() => {})
      await fs.rm(partial, { force: true }).catch(() => {})
      if (failure) {
        this.downloadState.status = 'error'
        this.downloadState.error = failure
      }
    }
  }
  async install(): Promise<void> {
    if (this.installing) return
    if (!this.readyFile || this.downloadState.status !== 'ready') throw new Error('请先下载并校验更新包')
    this.installing = true
    try {
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(this.readyFile.path)) hash.update(chunk)
      if (hash.digest('hex') !== this.readyFile.hash) throw new Error('更新文件校验失败，请重新下载')
      const error = await this.options.launch(this.readyFile.path)
      if (error) throw new Error(`无法启动安装程序：${error}`)
      this.scheduleInstallerCleanup(this.readyFile.path)
    } catch (error) {
      this.readyFile = null
      this.downloadState.status = 'error'
      this.downloadState.error = error instanceof Error ? error.message : '无法启动安装程序'
      throw error
    } finally { this.installing = false }
  }

  private scheduleInstallerCleanup(path: string): void {
    const delay = this.options.cleanupDelayMs ?? 5_000
    const timer = setTimeout(() => { void this.removeInstallerWithRetry(path) }, delay)
    // Cleanup must never keep the application alive if the user closes it while
    // the installer is still running.
    timer.unref?.()
  }

  private async removeInstallerWithRetry(path: string): Promise<void> {
    const attempts = Math.max(1, this.options.cleanupAttempts ?? 30)
    const interval = Math.max(0, this.options.cleanupRetryDelayMs ?? 2_000)
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        await fs.rm(path, { force: true, maxRetries: 0 })
        return
      } catch {
        if (attempt + 1 >= attempts) return
        await new Promise<void>((resolve) => setTimeout(resolve, interval))
      }
    }
  }
}
