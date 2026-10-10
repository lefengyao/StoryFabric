import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { SourceCatalog } from '../sourceCatalog'
import { executeTool } from '../../tools/registry'
import { extractIndexedDocument } from '../documentIndex'
import { epubFixture } from '../../../shared/__tests__/fixtures/documentFixtures'
import JSZip from 'jszip'
import { extractPdfDocumentText } from '../textExtractors'
import { MAX_INDEXED_DOCUMENT_CHARS, MAX_INDEXED_PDF_PAGES } from '../documentIndex'

const encoder = new TextEncoder()
const novel = `第一章 起点\n${'甲'.repeat(510_000)}\n第二章 终点\n这里有结尾证据。`
async function tool(store: MemoryFileStore, name: string, args: object): Promise<any> {
  const result = await executeTool(store, name, JSON.stringify(args))
  if (result.kind !== 'result' || !result.ok) throw new Error(result.kind === 'result' ? result.text : 'unexpected pending')
  return JSON.parse(result.text)
}

describe('indexed document retrieval', () => {
  it('indexes long DOCX paragraphs and more than 200 PDF pages within bounded budgets', async () => {
    const zip = new JSZip().file('word/document.xml', `<w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>${novel}</w:t></w:r></w:p></w:body></w:document>`)
    expect((await extractIndexedDocument('long.docx', await zip.generateAsync({ type: 'uint8array' }))).text).toBe(novel)
    const parts: Array<{ title: string; text: string }> = []
    const pdf = { numPages: 201, getPage: async (n: number) => ({ getTextContent: async () => ({ items: [{ str: `page ${n}` }] }) }), destroy: async () => {} }
    const text = await extractPdfDocumentText(pdf, { maxPdfPages: MAX_INDEXED_PDF_PAGES, maxChars: MAX_INDEXED_DOCUMENT_CHARS, onPart: (part) => parts.push(part) })
    expect(text).toContain('page 201')
    expect(parts.at(-1)?.title).toBe('第 201 页')
    await expect(extractPdfDocumentText({ ...pdf, numPages: 2001 }, { maxPdfPages: MAX_INDEXED_PDF_PAGES })).rejects.toMatchObject({ status: 'too-large' })
  })

  it('reads legacy extracted caches and retries the former extraction limit', async () => {
    const store = new MemoryFileStore()
    const catalog = new SourceCatalog(store)
    const source = await catalog.importBytes({ name: 'old.txt', bytes: encoder.encode(novel) })
    await catalog.extract(source.id)
    const cachePath = `.storyfabric/inspiration/extracted/${source.id}.json`
    const current = JSON.parse((await store.readText(cachePath))!)
    await store.writeText(cachePath, JSON.stringify({ ...current, version: 1, sections: undefined }))
    const directory = await tool(store, 'list_document_sections', { sourceId: source.id })
    expect(directory.sectionCount).toBeGreaterThan(1)
    const state = JSON.parse((await store.readText('.storyfabric/inspiration/catalog.json'))!)
    state.extraction[source.id] = { revision: current.revision, extraction: 'too-large' }
    await store.removeFile(cachePath)
    await store.writeText('.storyfabric/inspiration/catalog.json', JSON.stringify(state))
    expect(await catalog.extract(source.id)).toMatchObject({ extraction: 'ready', extractedChars: novel.length })
  })

  it('rejects a project document changed while its cached index is being read', async () => {
    class ChangingStore extends MemoryFileStore {
      change = false
      override async readText(path: string): Promise<string | null> {
        const text = await super.readText(path)
        if (this.change && path.startsWith('.storyfabric/documents/')) {
          this.change = false
          await super.writeText('docs/a.txt', 'new version')
        }
        return text
      }
    }
    const store = new ChangingStore()
    await store.writeText('docs/a.txt', 'old version')
    await tool(store, 'list_document_sections', { path: 'a.txt' })
    store.change = true
    expect(await executeTool(store, 'read_document_section', JSON.stringify({ path: 'a.txt', sectionId: 's1' }))).toMatchObject({ kind: 'result', ok: false, text: expect.stringContaining('变化') })
  })

  it('indexes a long novel without losing text or splitting surrogate pairs', async () => {
    const text = `第一章\n${'😀'.repeat(260_000)}\n第二章\n结尾证据`
    const index = await extractIndexedDocument('novel.txt', encoder.encode(text))
    expect(index.text).toBe(text)
    expect(index.sections.length).toBeGreaterThan(10)
    expect(index.sections.map((section) => index.text.slice(section.start, section.end)).join('')).toBe(text)
    for (const section of index.sections) {
      expect(section.end - section.start).toBeLessThanOrEqual(32_000)
      expect(index.text.slice(section.start, section.end)).not.toMatch(/^[\udc00-\udfff]|[\ud800-\udbff]$/)
    }
    expect(index.sections.at(-1)?.title).toContain('第二章')
  })

  it('preserves EPUB spine chapters beyond the former whole-book cap', async () => {
    const bytes = await epubFixture({ chapters: {
      'OPS/chapters/first.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>开场</h1><p>${'甲'.repeat(510_000)}</p></body></html>`,
      'OPS/chapters/second.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>尾声</h1><p>最终证据</p></body></html>'
    } })
    const index = await extractIndexedDocument('novel.epub', bytes)
    expect(index.text).toContain('最终证据')
    expect(index.sections[0].title).toContain('开场')
    expect(index.sections.at(-1)?.title).toContain('尾声')
  })

  for (const origin of ['docs', 'inspiration'] as const) {
    it(`lists, searches and reads the end of a >500k ${origin} document with bounded outputs`, async () => {
      const store = new MemoryFileStore()
      let reference: object
      if (origin === 'docs') {
        await store.writeText('docs/novel.txt', novel)
        reference = { path: 'novel.txt' }
        const end = await tool(store, 'read_project_doc', { path: 'novel.txt', offset: 510_000 })
        expect(end.content).toContain('结尾证据')
      } else {
        const catalog = new SourceCatalog(store)
        const source = await catalog.importBytes({ name: 'novel.txt', bytes: encoder.encode(novel) })
        expect(await catalog.extract(source.id)).toMatchObject({ extraction: 'ready', extractedChars: novel.length, sectionCount: expect.any(Number) })
        reference = { sourceId: source.id }
      }
      const directory = await tool(store, 'list_document_sections', { ...reference, limit: 2 })
      expect(directory.sections).toHaveLength(2)
      expect(directory.nextOffset).toBe(2)
      expect(directory.totalChars).toBe(novel.length)
      const hits = await tool(store, 'search_document', { ...reference, query: '结尾证据', revision: directory.revision })
      expect(hits.hits).toHaveLength(1)
      const part = await tool(store, 'read_document_section', { ...reference, sectionId: hits.hits[0].sectionId, revision: directory.revision, maxChars: 100 })
      expect(part.content).toContain('结尾证据')
      expect(part.content.length).toBeLessThanOrEqual(100)
      const bad = await executeTool(store, 'read_document_section', JSON.stringify({ ...reference, sectionId: 's1', maxChars: 20_001 }))
      expect(bad).toMatchObject({ kind: 'result', ok: false })
      if (origin === 'docs') await store.writeText('docs/novel.txt', 'changed')
      else {
        const source = (await new SourceCatalog(store).list())[0]
        await store.writeText(source.relativePath, 'changed')
      }
      const stale = await executeTool(store, 'read_document_section', JSON.stringify({ ...reference, sectionId: 's1', revision: directory.revision }))
      expect(stale).toMatchObject({ kind: 'result', ok: false, text: expect.stringMatching(/变化|版本/) })
    })
  }

  it('rejects ambiguous references and traversal and paginates repeated search hits', async () => {
    const store = new MemoryFileStore()
    await store.writeText('docs/a.md', '# A\nneedle needle needle')
    const hits = await tool(store, 'search_document', { path: 'a.md', query: 'needle', limit: 1 })
    const next = await tool(store, 'search_document', { path: 'a.md', query: 'needle', limit: 1, offset: hits.nextOffset })
    expect(next.hits[0].offset).toBeGreaterThan(hits.hits[0].offset)
    for (const args of [{ path: '../secret.txt' }, { path: 'a.md', sourceId: 'bad' }]) {
      expect(await executeTool(store, 'list_document_sections', JSON.stringify(args))).toMatchObject({ kind: 'result', ok: false })
    }
  })
})
