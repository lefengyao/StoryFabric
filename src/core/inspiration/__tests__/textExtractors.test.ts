import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { MAX_DOCX_DOCUMENT_XML_BYTES, MAX_PDF_EXTRACTED_CHARS, MAX_PDF_PAGES, extractPdfDocumentText, extractTextFromBytes } from '../textExtractors'

function simplePdf(text: string): Uint8Array {
  const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${text.replace(/[()\\]/g, '\\$&')}) Tj\nET\n`
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${new TextEncoder().encode(stream).byteLength} >>\nstream\n${stream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'
  ]
  let body = '%PDF-1.4\n'
  const offsets = objects.map((object) => {
    const offset = new TextEncoder().encode(body).byteLength
    body += object
    return offset
  })
  const xref = new TextEncoder().encode(body).byteLength
  body += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(body)
}

describe('text extractors', () => {
  it('decodes txt and markdown only as fatal UTF-8', async () => {
    await expect(extractTextFromBytes('notes.md', new TextEncoder().encode('# 标题\n正文'))).resolves.toBe('# 标题\n正文')
    await expect(extractTextFromBytes('broken.txt', new Uint8Array([0xff, 0xfe]))).rejects.toMatchObject({ status: 'failed' })
  })

  it('extracts paragraph text from a DOCX document.xml', async () => {
    const zip = new JSZip()
    zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>第一段</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">第二段</w:t></w:r></w:p></w:body></w:document>')

    await expect(extractTextFromBytes('reference.docx', await zip.generateAsync({ type: 'uint8array' }))).resolves.toBe('第一段\n第二段')
  })

  it('treats a ZIP with malformed DOCX XML as unsupported', async () => {
    const zip = new JSZip()
    zip.file('word/document.xml', '<w:document><w:body><w:p><w:t>unterminated')

    await expect(extractTextFromBytes('broken-xml.docx', await zip.generateAsync({ type: 'uint8array' }))).rejects.toMatchObject({ status: 'unsupported' })
  })

  it('reads only DOCX w:t body text rather than w:t-looking comment content', async () => {
    const zip = new JSZip()
    zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="urn:test"><w:body><!-- <w:t>not body text</w:t> --><w:p><w:r><w:t>body text</w:t></w:r></w:p></w:body></w:document>')

    await expect(extractTextFromBytes('comment.docx', await zip.generateAsync({ type: 'uint8array' }))).resolves.toBe('body text')
  })

  it('maps invalid DOCX numeric entities to TextExtractionError', async () => {
    const zip = new JSZip()
    zip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>&#x110000;</w:t></w:r></w:p></w:body></w:document>')

    await expect(extractTextFromBytes('invalid-entity.docx', await zip.generateAsync({ type: 'uint8array' }))).rejects.toMatchObject({ status: 'unsupported' })
  })

  it('rejects a DOCX document with an unbound w namespace prefix', async () => {
    const zip = new JSZip()
    zip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>forged</w:t></w:r></w:p></w:body></w:document>')

    await expect(extractTextFromBytes('unbound-prefix.docx', await zip.generateAsync({ type: 'uint8array' }))).rejects.toMatchObject({ status: 'unsupported' })
  })

  it('rejects unresolved entities in DOCX attributes', async () => {
    const zip = new JSZip()
    zip.file('word/document.xml', '<w:document xmlns:w="urn:test" x="&broken;"><w:body><w:p><w:r><w:t>forged</w:t></w:r></w:p></w:body></w:document>')

    await expect(extractTextFromBytes('bad-attribute.docx', await zip.generateAsync({ type: 'uint8array' }))).rejects.toMatchObject({ status: 'unsupported' })
  })

  it('rejects a DOCX document.xml entry above its bounded expanded size before extraction', async () => {
    const zip = new JSZip()
    zip.file('word/document.xml', new Uint8Array(MAX_DOCX_DOCUMENT_XML_BYTES + 1))

    await expect(extractTextFromBytes('zip-bomb.docx', await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }))).rejects.toMatchObject({ status: 'too-large' })
  })

  it('stops PDF extraction before an excessive page count or text budget is accumulated', async () => {
    const overPages = {
      numPages: MAX_PDF_PAGES + 1,
      getPage: async () => { throw new Error('must not read a page over the cap') },
      destroy: async () => undefined
    }
    const overText = {
      numPages: 1,
      getPage: async () => ({ getTextContent: async () => ({ items: [{ str: 'x'.repeat(MAX_PDF_EXTRACTED_CHARS + 1) }] }) }),
      destroy: async () => undefined
    }

    await expect(extractPdfDocumentText(overPages)).rejects.toMatchObject({ status: 'too-large' })
    await expect(extractPdfDocumentText(overText)).rejects.toMatchObject({ status: 'too-large' })
  })

  it('extracts text from a real PDF using the Node-compatible pdfjs entrypoint', async () => {
    await expect(extractTextFromBytes('reference.pdf', simplePdf('PDF evidence'))).resolves.toContain('PDF evidence')
  })

  it('marks invalid DOCX and PDF bytes unsupported without inventing content', async () => {
    await expect(extractTextFromBytes('broken.docx', new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ status: 'unsupported' })
    await expect(extractTextFromBytes('broken.pdf', new Uint8Array([37, 80, 68, 70, 45]))).rejects.toMatchObject({ status: 'unsupported' })
  })
})
