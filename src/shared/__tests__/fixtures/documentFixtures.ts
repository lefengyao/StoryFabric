import JSZip from 'jszip'

export function simplePdf(text: string): Uint8Array {
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

export async function epubFixture(options: { packageXml?: string; containerXml?: string; chapters?: Record<string, string>; encryptionXml?: string } = {}): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip')
  zip.file('META-INF/container.xml', options.containerXml ?? '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
  zip.file('OPS/book.opf', options.packageXml ?? '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata/><manifest><item id="second" href="chapters/second.xhtml" media-type="application/xhtml+xml"/><item id="first" href="chapters/first.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="first"/><itemref idref="second"/></spine></package>')
  for (const [path, text] of Object.entries(options.chapters ?? {
    'OPS/chapters/second.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>第二章</h1><p>后来发生的事。</p></body></html>',
    'OPS/chapters/first.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>不进入正文</title><style>不进入正文</style></head><body><h1>第一章</h1><p>你好<em>世界</em> &amp; 再见。</p><script>不进入正文</script><p>下一段<br/>下一行</p></body></html>'
  })) zip.file(path, text)
  if (options.encryptionXml) zip.file('META-INF/encryption.xml', options.encryptionXml)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
