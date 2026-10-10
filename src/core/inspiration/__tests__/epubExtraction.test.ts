import { describe, expect, it } from 'vitest'
import { extractTextFromBytes, supportsTextExtraction } from '../textExtractors'
import { epubFixture } from '../../../shared/__tests__/fixtures/documentFixtures'

describe('EPUB text extraction', () => {
  it('recognizes EPUB and extracts body paragraphs in spine order', async () => {
    expect(supportsTextExtraction('BOOK.EPUB')).toBe(true)
    expect(await extractTextFromBytes('book.epub', await epubFixture())).toBe('第一章\n你好世界 & 再见。\n下一段\n下一行\n\n第二章\n后来发生的事。')
  })

  it('reads namespace-prefixed EPUB 2 metadata and encoded relative chapter paths', async () => {
    const bytes = await epubFixture({
      containerXml: '<c:container xmlns:c="urn:oasis:names:tc:opendocument:xmlns:container"><c:rootfiles><c:rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></c:rootfiles></c:container>',
      packageXml: '<o:package xmlns:o="http://www.idpf.org/2007/opf" version="2.0"><o:manifest><o:item id="c" href="../Text/%E7%AC%AC%E4%B8%80%E7%AB%A0.xhtml#start" media-type="application/xhtml+xml"/></o:manifest><o:spine><o:itemref idref="c"/></o:spine></o:package>',
      chapters: { 'Text/第一章.xhtml': '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd"><html xmlns="http://www.w3.org/1999/xhtml"><body><p>甲&nbsp;乙</p></body></html>' }
    })
    expect(await extractTextFromBytes('book.epub', bytes)).toBe('甲 乙')
  })

  it('omits navigation and non-linear supplementary documents', async () => {
    const bytes = await epubFixture({ packageXml: '<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="first" href="chapters/first.xhtml" media-type="application/xhtml+xml"/><item id="appendix" href="missing.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="nav"/><itemref idref="first"/><itemref idref="appendix" linear="no"/></spine></package>' })
    expect(await extractTextFromBytes('book.epub', bytes)).not.toContain('第二章')
    expect(await extractTextFromBytes('book.epub', bytes)).toContain('第一章')
  })

  it.each([
    ['missing manifest reference', '<item id="first" href="chapters/first.xhtml" media-type="application/xhtml+xml"/>', 'missing'],
    ['missing chapter', '<item id="first" href="missing.xhtml" media-type="application/xhtml+xml"/>', 'first'],
    ['external chapter', '<item id="first" href="https://example.com/book.xhtml" media-type="application/xhtml+xml"/>', 'first'],
    ['archive path escape', '<item id="first" href="../../outside.xhtml" media-type="application/xhtml+xml"/>', 'first']
  ])('rejects %s without producing partial evidence', async (_name, item, idref) => {
    const bytes = await epubFixture({ packageXml: `<package xmlns="http://www.idpf.org/2007/opf"><manifest>${item}</manifest><spine><itemref idref="${idref}"/></spine></package>` })
    await expect(extractTextFromBytes('book.epub', bytes)).rejects.toMatchObject({ status: 'unsupported' })
  })

  it('rejects encrypted body chapters but allows obfuscated font resources', async () => {
    const encrypted = (uri: string): string => `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:e="http://www.w3.org/2001/04/xmlenc#"><e:EncryptedData><e:CipherData><e:CipherReference URI="${uri}"/></e:CipherData></e:EncryptedData></encryption>`
    await expect(extractTextFromBytes('book.epub', await epubFixture({ encryptionXml: encrypted('OPS/chapters/first.xhtml') }))).rejects.toThrow(/加密|DRM/)
    await expect(extractTextFromBytes('book.epub', await epubFixture({ encryptionXml: encrypted('OPS/fonts/body.otf') }))).resolves.toContain('第一章')
  })

  it('rejects malformed XHTML and custom entities', async () => {
    for (const text of ['<html><body><p>破损', '<!DOCTYPE html [<!ENTITY secret "伪造">]><html><body><p>&secret;</p></body></html>']) {
      await expect(extractTextFromBytes('book.epub', await epubFixture({ chapters: { 'OPS/chapters/first.xhtml': text } }))).rejects.toMatchObject({ status: 'unsupported' })
    }
  })

  it('stops compressed oversized chapter entries and excessive extracted text', async () => {
    for (const length of [4 * 1024 * 1024 + 1, 500_001]) {
      const bytes = await epubFixture({ chapters: { 'OPS/chapters/first.xhtml': `<html><body><p>${'x'.repeat(length)}</p></body></html>` } })
      await expect(extractTextFromBytes('book.epub', bytes)).rejects.toMatchObject({ status: 'too-large' })
    }
  })

  it('rejects archives without a valid container and image-only books', async () => {
    await expect(extractTextFromBytes('book.epub', new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ status: 'unsupported' })
    await expect(extractTextFromBytes('book.epub', await epubFixture({ containerXml: '<invalid/>' }))).rejects.toMatchObject({ status: 'unsupported' })
    await expect(extractTextFromBytes('book.epub', await epubFixture({ chapters: { 'OPS/chapters/first.xhtml': '<html><body><img src="page.png"/></body></html>', 'OPS/chapters/second.xhtml': '<html><body/></html>' } }))).rejects.toThrow(/正文|文本/)
  })
})
