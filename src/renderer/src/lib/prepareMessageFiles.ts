import type { MessageFile } from '../../../shared/types'
import type { StoryFabricApi } from '../../../shared/api'
import type { InspirationImport, InspirationSource } from '../../../shared/inspiration'
import { documentReference } from '../../../core/inspiration/documentReference'
import { bytesToBase64 } from '../platform/archiveTransfer'
import { documentMimeType } from '../../../core/inspiration/documentFormats'
import { MAX_FILES_PER_MESSAGE, MAX_IMAGE_BYTES, MAX_TEXT_BYTES, MAX_MESSAGE_BYTES, validateMessageFiles } from '../../../core/attachments/validation'

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `file_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}

export async function prepareMessageFiles(files: File[], options: { persistDocument?: (input: InspirationImport) => Promise<InspirationSource> } = {}): Promise<MessageFile[]> {
  if (files.length > MAX_FILES_PER_MESSAGE) throw new Error(`每条消息最多添加 ${MAX_FILES_PER_MESSAGE} 个文件`)
  let sourceBytes = 0
  for (const file of files) {
    const limit = IMAGE_TYPES.has(file.type) ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES
    if (file.size > limit) throw new Error(`文件大小不能超过 100 MiB：${file.name}`)
    sourceBytes += file.size
    if (sourceBytes > MAX_MESSAGE_BYTES) throw new Error('本条消息附件总大小不能超过 100 MiB')
  }
  const result: MessageFile[] = []
  for (const file of files) {
    const imageType = IMAGE_TYPES.has(file.type) ? file.type as 'image/png' | 'image/jpeg' | 'image/webp' : undefined
    const textType = documentMimeType(file.name)
    if (!imageType && !textType) throw new Error(`不支持的附件类型：${file.name}`)
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (imageType) {
      result.push({ kind: 'image', id: makeId(), name: file.name, mimeType: imageType, size: bytes.byteLength, base64: bytesToBase64(bytes) })
    } else if (textType) {
      const { extractIndexedDocument } = await import('../../../core/inspiration/documentIndex')
      let { text } = await extractIndexedDocument(file.name, bytes)
      if (!text.trim()) throw new Error(`文件没有可提取的文本：${file.name}`)
      if (text.length > 20_000) {
        if (!options.persistDocument) throw new Error('长资料需要保存到已打开的工作区，请打开项目后添加附件')
        const source = await options.persistDocument({ name: file.name, bytes })
        text = documentReference(source, text)
      }
      result.push({ kind: 'text', id: makeId(), name: file.name, mimeType: textType, size: new TextEncoder().encode(text).byteLength, text })
    }
  }
  return validateMessageFiles(result)
}

type DocumentApi = Pick<StoryFabricApi, 'importInspirationSource' | 'extractInspirationSource' | 'removeInspirationSource'>

/** Originals live with the project so references remain readable after reopening a chat. */
export async function prepareWorkspaceMessageFiles(api: DocumentApi, files: File[]): Promise<MessageFile[]> {
  const imported: string[] = []
  try {
    return await prepareMessageFiles(files, { persistDocument: async (input) => {
      if (!api.importInspirationSource || !api.extractInspirationSource || !api.removeInspirationSource) throw new Error('当前平台未提供工作区资料导入，请更新应用后重试')
      const source = await api.importInspirationSource(input)
      imported.push(source.id)
      const indexed = await api.extractInspirationSource(source.id)
      if (indexed.extraction !== 'ready' || indexed.extractedChars === undefined) throw new Error(indexed.extractionError ?? (indexed.extraction === 'too-large' ? '资料超过索引上限，请按卷拆分后导入' : `无法建立资料索引：${source.displayName}`))
      return indexed
    } })
  } catch (error) {
    const cleanup = await Promise.allSettled(imported.map((id) => api.removeInspirationSource!(id)))
    if (cleanup.some((result) => result.status === 'rejected')) throw new Error(`${error instanceof Error ? error.message : error}；未完成的导入资料可在灵感台移除`)
    throw error
  }
}
