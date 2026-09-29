import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shareFiles } from './shareFiles'
import { shareChapterImages } from './chapterLongImage'

const native = vi.hoisted(() => ({
  enabled: false,
  writeFile: vi.fn(),
  getUri: vi.fn(),
  share: vi.fn()
}))

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.enabled } }))
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Filesystem: { writeFile: native.writeFile, getUri: native.getUri }
}))
vi.mock('@capacitor/share', () => ({ Share: { share: native.share } }))

describe('shareFiles', () => {
  const file = new File(['image'], '设定图谱.png', { type: 'image/png' })
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL

  beforeEach(() => {
    native.enabled = false
    native.writeFile.mockReset()
    native.getUri.mockReset()
    native.share.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
    vi.restoreAllMocks()
  })

  it('downloads each file when browser file sharing is unavailable', async () => {
    const links: Array<{ href: string; download: string; click: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }> = []
    const append = vi.fn()
    vi.stubGlobal('navigator', { canShare: () => false })
    vi.stubGlobal('document', {
      body: { append },
      createElement: () => {
        const link = { href: '', download: '', click: vi.fn(), remove: vi.fn() }
        links.push(link)
        return link
      }
    })
    vi.stubGlobal('window', { setTimeout: vi.fn() })
    URL.createObjectURL = vi.fn(() => 'blob:settings')
    URL.revokeObjectURL = vi.fn()

    await expect(shareFiles([file], '设定图谱', '分享设定图谱')).resolves.toBe('downloaded')
    expect(links).toHaveLength(1)
    expect(links[0].download).toBe('设定图谱.png')
    expect(links[0].href).toBe('blob:settings')
    expect(links[0].click).toHaveBeenCalledOnce()
    expect(append).toHaveBeenCalledWith(links[0])
  })

  it('passes the supplied title to browser sharing', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { canShare: () => true, share })

    await expect(shareFiles([file], '设定图谱', '分享设定图谱')).resolves.toBe('shared')
    expect(share).toHaveBeenCalledWith({ title: '设定图谱', files: [file] })
  })

  it('writes files to native cache and opens native sharing', async () => {
    native.enabled = true
    native.writeFile.mockResolvedValue(undefined)
    native.getUri.mockResolvedValue({ uri: 'file:///cache/tree.png' })
    native.share.mockResolvedValue(undefined)
    class TestFileReader {
      result = 'data:image/png;base64,aW1hZ2U='
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      readAsDataURL(): void { this.onload?.() }
    }
    vi.stubGlobal('FileReader', TestFileReader)

    await expect(shareFiles([file], '设定图谱', '分享设定图谱')).resolves.toBe('shared')
    expect(native.writeFile).toHaveBeenCalledWith(expect.objectContaining({ directory: 'CACHE', data: 'aW1hZ2U=', recursive: true }))
    expect(native.share).toHaveBeenCalledWith({ title: '设定图谱', files: ['file:///cache/tree.png'], dialogTitle: '分享设定图谱' })
  })

  it('keeps the chapter wrapper title and sharing result', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { canShare: () => true, share })

    await expect(shareChapterImages([file])).resolves.toBe('shared')
    expect(share).toHaveBeenCalledWith({ title: file.name, files: [file] })
  })
})
