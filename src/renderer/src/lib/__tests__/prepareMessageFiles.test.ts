import { describe, expect, it, vi } from 'vitest'
import { prepareMessageFiles, prepareWorkspaceMessageFiles } from '../prepareMessageFiles'
import { MemoryFileStore } from '../../../../core/storage/fileStore'
import { SourceCatalog } from '../../../../core/inspiration/sourceCatalog'
import { executeTool } from '../../../../core/tools/registry'
import JSZip from 'jszip'
import { validateMessageFiles, MAX_TEXT_BYTES, MAX_FILES_PER_MESSAGE } from '../../../../core/attachments/validation'
import { epubFixture, simplePdf } from '../../../../shared/__tests__/fixtures/documentFixtures'
import { toOpenAiMessageContent, toAnthropicMessageContent, toGeminiMessageParts } from '../../../../core/attachments/messageContent'

describe('prepareMessageFiles', () => {
  it('persists long attachments and sends a compact searchable reference', async () => {
    const store = new MemoryFileStore()
    const catalog = new SourceCatalog(store)
    const text = `第一章\n${'甲'.repeat(510_000)}\n第二章\n末尾线索`
    const api = {
      importInspirationSource: (input: { name: string; bytes: Uint8Array }) => catalog.importBytes(input),
      extractInspirationSource: (id: string) => catalog.extract(id),
      removeInspirationSource: (id: string) => catalog.removeImported(id)
    }
    const files = await prepareWorkspaceMessageFiles(api, [new File([text], '长篇.txt')])
    expect(files[0]).toMatchObject({ kind: 'text', text: expect.stringContaining('sourceId') })
    if (files[0].kind !== 'text') throw new Error('expected text')
    expect(files[0].text.length).toBeLessThan(4000)
    const source = (await catalog.list())[0]
    expect(await store.readBytes(source.relativePath)).toEqual(new TextEncoder().encode(text))
    const hits = await executeTool(store, 'search_document', JSON.stringify({ sourceId: source.id, query: '末尾线索' }))
    expect(hits).toMatchObject({ kind: 'result', ok: true, text: expect.stringContaining('末尾线索') })
  })

  it('rolls back newly imported attachments if another selected file fails', async () => {
    const store = new MemoryFileStore()
    const catalog = new SourceCatalog(store)
    const remove = vi.fn((id: string) => catalog.removeImported(id))
    await expect(prepareWorkspaceMessageFiles({
      importInspirationSource: (input) => catalog.importBytes(input),
      extractInspirationSource: (id) => catalog.extract(id),
      removeInspirationSource: remove
    }, [new File(['x'.repeat(30_000)], 'long.txt'), new File(['broken'], 'bad.epub')])).rejects.toThrow(/EPUB/)
    expect(remove).toHaveBeenCalledOnce()
    expect(await catalog.list()).toEqual([])
  })

  it('prepares image and text files with normalized payloads', async () => {
    const image = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], '封面.png', { type: 'image/png' })
    const text = new File(['计划内容'], '计划.md', { type: 'text/markdown' })
    const files = await prepareMessageFiles([image, text])
    expect(files).toHaveLength(2)
    expect(files[0]).toMatchObject({ kind: 'image', name: '封面.png', mimeType: 'image/png', size: 8 })
    expect(files[1]).toMatchObject({ kind: 'text', name: '计划.md', mimeType: 'text/markdown', text: '计划内容' })
  })

  it('extracts EPUB and DOCX attachments into validated provider text blocks', async () => {
    const docx = new JSZip().file('word/document.xml', '<w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>文档正文</w:t></w:r></w:p></w:body></w:document>')
    const files = validateMessageFiles(await prepareMessageFiles([
      new File([Uint8Array.from(await epubFixture()).buffer], '小说.epub', { type: 'application/epub+zip' }),
      new File([Uint8Array.from(await docx.generateAsync({ type: 'uint8array' })).buffer], '参考.docx'),
      new File(['world: 海上'], '设定.yaml')
    ]))
    expect(files).toMatchObject([
      { kind: 'text', name: '小说.epub', mimeType: 'application/epub+zip', text: expect.stringContaining('第一章') },
      { kind: 'text', name: '参考.docx', text: '文档正文' },
      { kind: 'text', name: '设定.yaml', text: 'world: 海上' }
    ])
    const message = { id: 'message', role: 'user' as const, text: '分析资料', files }
    for (const output of [toOpenAiMessageContent(message), toAnthropicMessageContent(message), toGeminiMessageParts(message)]) {
      expect(JSON.stringify(output)).toContain('第一章')
      expect(JSON.stringify(output)).toContain('文档正文')
    }
  })

  it('rejects excessive file counts and source sizes before reading bytes', async () => {
    await expect(prepareMessageFiles(Array.from({ length: MAX_FILES_PER_MESSAGE + 1 }, () => new File(['x'], 'a.txt')))).rejects.toThrow(/最多/)
    const file = new File(['x'], 'large.epub')
    Object.defineProperty(file, 'size', { value: MAX_TEXT_BYTES + 1 })
    file.arrayBuffer = async () => { throw new Error('should not read oversized file') }
    await expect(prepareMessageFiles([file])).rejects.toThrow(/大小|100/)
  })

  it('extracts and validates a real PDF attachment', async () => {
    const files = await prepareMessageFiles([new File([Uint8Array.from(simplePdf('PDF evidence')).buffer], 'reference.pdf')])
    expect(files).toMatchObject([{ kind: 'text', name: 'reference.pdf', mimeType: 'application/pdf', text: expect.stringContaining('PDF evidence') }])
  })

  it('reports empty documents and malformed EPUB attachments', async () => {
    await expect(prepareMessageFiles([new File([''], 'empty.txt')])).rejects.toThrow(/空|文本/)
    await expect(prepareMessageFiles([new File(['not an EPUB'], 'broken.epub')])).rejects.toThrow(/EPUB/)
  })
})
