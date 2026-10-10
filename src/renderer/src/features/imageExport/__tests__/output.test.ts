import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ native: false, share: vi.fn(), write: vi.fn(), uri: vi.fn(), remove: vi.fn(), save: vi.fn() }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => mocks.native } }))
vi.mock('@capacitor/filesystem', () => ({ Directory: { Cache: 'CACHE' }, Filesystem: { writeFile: mocks.write, getUri: mocks.uri, deleteFile: mocks.remove } }))
vi.mock('@capacitor/share', () => ({ Share: { share: mocks.share } }))
vi.mock('../../../platform/platformApi', () => ({ getPlatformApi: () => ({ saveImageFile: mocks.save }) }))
import { saveImageOutput } from '../output'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.native = false
  mocks.share.mockResolvedValue({}); mocks.write.mockResolvedValue({}); mocks.uri.mockResolvedValue({ uri: 'file:///cache/export.png' }); mocks.remove.mockResolvedValue({}); mocks.save.mockResolvedValue(undefined)
  vi.stubGlobal('window', { api: {} })
  vi.stubGlobal('FileReader', class {
    result: string | null = null
    onload: (() => void) | null = null
    readAsDataURL() { this.result = 'data:image/png;base64,cG5n'; this.onload?.() }
  })
})

describe('PNG platform output', () => {
  it('passes exact PNG bytes to desktop save dialog without writing project files', async () => {
    await saveImageOutput(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), '远星.png')
    expect(mocks.save).toHaveBeenCalledWith('远星.png', new Uint8Array([1, 2, 3]))
    expect(mocks.write).not.toHaveBeenCalled()
  })
  it('uses Android cache and shares the URI, cleaning temporary PNG afterwards', async () => {
    mocks.native = true
    await saveImageOutput(new Blob(['png'], { type: 'image/png' }), '远星.png')
    expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({ directory: 'CACHE', data: 'cG5n', path: expect.stringMatching(/^image-export\//) }))
    expect(mocks.share).toHaveBeenCalledWith(expect.objectContaining({ files: ['file:///cache/export.png'] }))
    expect(mocks.remove).toHaveBeenCalledWith(expect.objectContaining({ directory: 'CACHE', path: mocks.write.mock.calls[0][0].path }))
    expect(mocks.remove.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.share.mock.invocationCallOrder[0])
  })
  it('treats cancelled Android sharing as cancellation and still releases the temporary file', async () => {
    mocks.native = true; mocks.share.mockRejectedValue(new Error('Share canceled'))
    await expect(saveImageOutput(new Blob(['png']), 'test.png')).resolves.toBeUndefined()
    expect(mocks.remove).toHaveBeenCalledOnce()
  })
  it('surfaces Android permission failures and cleans an attempted temporary export', async () => {
    mocks.native = true; mocks.write.mockRejectedValue(new Error('Permission denied'))
    await expect(saveImageOutput(new Blob(['png']), 'test.png')).rejects.toThrow('Permission denied')
    expect(mocks.share).not.toHaveBeenCalled()
    expect(mocks.remove).toHaveBeenCalledOnce()
  })
})
