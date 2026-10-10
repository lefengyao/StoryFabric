import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { AppUpdateService } from '../appUpdateService'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map((p) => fs.rm(p, { recursive: true, force: true }))) })
async function service(file = 'installer', hash = createHash('sha256').update(file).digest('hex')) {
  const dir = await fs.mkdtemp(join(tmpdir(), 'storyfabric-update-test-')); dirs.push(dir)
  const launch = vi.fn(async () => '')
  const fetchImpl = vi.fn(async (input, init) => {
    const url = String(input)
    if (url.endsWith('versions.json')) return Response.json({ catalogFormat: 2, latestId: 'r', releases: [{ id: 'r', version: '0.2.27', packages: [{ platform: 'windows', channel: 'installer', bytes: file.length, sha256: hash, url: '/releases/0.2.27/StoryFabric-Setup-0.2.27.exe' }] }] })
    if (url.includes('api.github')) return Response.json([])
    if (init?.method === 'HEAD') return new Response(null, { headers: { 'content-length': String(file.length) } })
    return new Response(file)
  }) as typeof fetch
  const updater = new AppUpdateService({ directory: dir, currentVersion: '0.2.26', platform: 'windows', preferences: async () => undefined, fetchImpl, launch, cleanupDelayMs: 10 })
  await updater.check()
  return { updater, dir, launch, fetchImpl }
}
describe('desktop update download', () => {
  it('writes streamed chunks in order before validating the checksum', async () => {
    const { updater, fetchImpl, dir } = await service()
    vi.mocked(fetchImpl).mockResolvedValue(new Response(new ReadableStream({ start(controller) {
      controller.enqueue(Buffer.from('inst')); controller.enqueue(Buffer.from('aller')); controller.close()
    } })))
    updater.download()
    await vi.waitFor(() => expect(updater.state().status).toBe('ready'))
    expect(await fs.readFile(join(dir, 'StoryFabric-Setup-0.2.27.exe'), 'utf8')).toBe('installer')
  })
  it('handles a file removed after detection without launching it', async () => {
    const { updater, dir, launch, fetchImpl } = await service()
    vi.mocked(fetchImpl).mockResolvedValue(new Response(null, { status: 404 }))
    updater.download()
    await vi.waitFor(() => expect(updater.state().status).toBe('error'))
    expect(updater.state().error).toContain('不可用')
    expect(await fs.readdir(dir)).toEqual([])
    expect(launch).not.toHaveBeenCalled()
  })
  it('cancels a pending transfer and allows retry', async () => {
    const { updater, fetchImpl } = await service()
    vi.mocked(fetchImpl).mockImplementationOnce(async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
    }))
    updater.download()
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(4))
    updater.cancel()
    await vi.waitFor(() => expect(updater.state().status).toBe('error'))
    updater.download()
    await vi.waitFor(() => expect(updater.state().status).toBe('ready'))
  })
  it('downloads, verifies and only launches on explicit install', async () => {
    const { updater, launch } = await service()
    await updater.download()
    await vi.waitFor(() => expect(updater.state().status).toBe('ready'))
    expect(launch).not.toHaveBeenCalled()
    await updater.install()
    expect(launch).toHaveBeenCalledOnce()
  })
  it('removes the verified installer after the installer starts', async () => {
    const { updater, dir } = await service()
    await updater.download()
    await vi.waitFor(() => expect(updater.state().status).toBe('ready'))
    await updater.install()

    expect(await fs.readdir(dir)).toEqual(['StoryFabric-Setup-0.2.27.exe'])
    await vi.waitFor(async () => expect(await fs.readdir(dir)).toEqual([]), { timeout: 1_000 })
  })
  it('keeps the installer when it cannot be started', async () => {
    const { updater, dir, launch } = await service()
    vi.mocked(launch).mockResolvedValue('安装程序被系统拒绝')
    await updater.download()
    await vi.waitFor(() => expect(updater.state().status).toBe('ready'))

    await expect(updater.install()).rejects.toThrow('无法启动安装程序')
    expect(await fs.readdir(dir)).toEqual(['StoryFabric-Setup-0.2.27.exe'])
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(await fs.readdir(dir)).toEqual(['StoryFabric-Setup-0.2.27.exe'])
  })
  it('rejects a corrupt package and removes the partial file', async () => {
    const { updater, dir, launch } = await service('installer', 'a'.repeat(64))
    await updater.download()
    await vi.waitFor(() => expect(updater.state().status).toBe('error'))
    expect(updater.state().error).toContain('校验')
    await vi.waitFor(async () => expect(await fs.readdir(dir)).toEqual([]), { timeout: 1_000 })
    await expect(updater.install()).rejects.toThrow()
    expect(launch).not.toHaveBeenCalled()
  })
  it('rechecks the file before launch and rejects local modification', async () => {
    const { updater, dir, launch } = await service()
    await updater.download()
    await vi.waitFor(() => expect(updater.state().status).toBe('ready'))
    await fs.writeFile(join(dir, 'StoryFabric-Setup-0.2.27.exe'), 'changed')
    await expect(updater.install()).rejects.toThrow('校验')
    expect(launch).not.toHaveBeenCalled()
  })
})
