import JSZip from 'jszip'
import { PACKAGE_LIMITS, validateContentPackage } from './packageValidator'
import type { ContentPackage, ContentPackageFile } from './types'

const MANIFEST_PATH = 'manifest.json'

function archivePath(value: string): string {
  const path = value.replace(/\\/g, '/')
  if (!path || path.startsWith('/') || /^[A-Za-z]:\//.test(path) || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('内容包压缩文件包含非法路径')
  }
  return path
}

function declaredSize(entry: JSZip.JSZipObject): number | null {
  const data = (entry as unknown as { _data?: { uncompressedSize?: unknown } })._data
  return typeof data?.uncompressedSize === 'number' && Number.isFinite(data.uncompressedSize) ? data.uncompressedSize : null
}

/** Decodes a declarative .storyfabric.plugin.zip before the regular package schema validation. */
export async function decodeContentPackageArchive(input: Uint8Array | ArrayBuffer): Promise<ContentPackage> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (!bytes.byteLength || bytes.byteLength > PACKAGE_LIMITS.compressedBytes) throw new Error('内容包压缩文件大小无效或超过限制')

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes, { createFolders: false })
  } catch {
    throw new Error('无法读取内容包压缩文件')
  }

  const paths = new Set<string>()
  const portablePaths = new Set<string>()
  const files: ContentPackageFile[] = []
  let manifest: unknown
  let expandedBytes = 0
  const decoder = new TextDecoder('utf-8', { fatal: true })

  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue
    if (paths.size >= PACKAGE_LIMITS.entries + 1) throw new Error('内容包压缩文件条目数量超过限制')
    const original = entry.unsafeOriginalName ?? entry.name
    const path = archivePath(original)
    const portableKey = path.normalize('NFC').toLowerCase()
    if (path !== entry.name || paths.has(path) || portablePaths.has(portableKey)) throw new Error('内容包压缩文件包含冲突路径')
    const expectedSize = declaredSize(entry)
    if (expectedSize !== null && expectedSize > PACKAGE_LIMITS.expandedBytes) throw new Error('内容包压缩文件包含过大的文件')

    const content = await entry.async('uint8array')
    expandedBytes += content.byteLength
    if (expandedBytes > PACKAGE_LIMITS.expandedBytes) throw new Error('内容包压缩文件解压后超过限制')
    let text: string
    try {
      text = decoder.decode(content)
    } catch {
      throw new Error(`内容包压缩文件包含非 UTF-8 文本：${path}`)
    }
    if (path === MANIFEST_PATH) {
      try {
        manifest = JSON.parse(text)
      } catch {
        throw new Error('内容包 manifest.json 无效')
      }
    } else {
      files.push({ path, content: text })
    }
    paths.add(path)
    portablePaths.add(portableKey)
  }

  if (manifest === undefined) throw new Error('内容包压缩文件缺少 manifest.json')
  return validateContentPackage({ manifest, files })
}
