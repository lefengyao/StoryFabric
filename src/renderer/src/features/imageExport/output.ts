import { getPlatformApi } from '../../platform/platformApi'

function cancellation(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /cancel|取消|dismiss/i.test(error.message))
}

export async function saveImageOutput(blob: Blob, fileName: string): Promise<void> {
  const { Capacitor } = await import('@capacitor/core')
  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')])
    const path = `image-export/${Date.now()}-${Math.random().toString(36).slice(2)}-${fileName}`
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(new Error('无法读取 PNG 数据'))
        reader.onload = () => resolve(String(reader.result).split(',')[1])
        reader.readAsDataURL(blob)
      })
      await Filesystem.writeFile({ path, directory: Directory.Cache, data, recursive: true })
      const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache })
      await Share.share({ title: fileName, dialogTitle: '保存或分享 PNG', files: [uri] })
    } catch (error) { if (!cancellation(error)) throw error }
    finally { await Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => undefined) }
    return
  }
  const platform = getPlatformApi() as ReturnType<typeof getPlatformApi> & { saveImageFile?: (fileName: string, bytes: Uint8Array) => Promise<void> }
  if (window.api && platform.saveImageFile) {
    try { await platform.saveImageFile(fileName, new Uint8Array(await blob.arrayBuffer())) }
    catch (error) { if (!cancellation(error)) throw error }
    return
  }
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  try {
    anchor.href = url; anchor.download = fileName; document.body.append(anchor); anchor.click()
    // Allow Chromium to consume the Blob before releasing the URL.
    await new Promise<void>((resolve) => setTimeout(resolve, 1000))
  } finally { anchor.remove(); URL.revokeObjectURL(url) }
}
