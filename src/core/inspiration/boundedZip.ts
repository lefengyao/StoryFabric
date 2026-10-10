import type JSZip from 'jszip'
import { TextExtractionError } from './extractionErrors'

/** Stop decompression before allocating an oversized XML entry. */
export function readBoundedZipEntry(file: JSZip.JSZipObject, limit: number): Promise<Uint8Array> {
  const stream = (file as JSZip.JSZipObject & { internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array> }).internalStream('uint8array')
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let size = 0
    let stopped = false
    stream.on('data', (chunk) => {
      if (stopped) return
      size += chunk.length
      if (size > limit) {
        stopped = true
        stream.pause()
        chunks.length = 0
        reject(new TextExtractionError('too-large', `DOCX 解压正文超过 ${limit} 字节上限，请拆分文档`))
      } else chunks.push(chunk)
    }).on('error', () => { stopped = true; reject(new TextExtractionError('unsupported', 'DOCX 正文无法解压')) })
      .on('end', () => {
        if (stopped) return
        const bytes = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
        resolve(bytes)
      }).resume()
  })
}
