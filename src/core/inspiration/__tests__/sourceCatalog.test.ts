import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { MAX_INSPIRATION_SOURCE_BYTES, MAX_INSPIRATION_TOTAL_BYTES, SourceCatalog } from '../sourceCatalog'
import { epubFixture } from '../../../shared/__tests__/fixtures/documentFixtures'

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined
}

async function docxBytes(xml: string): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('word/document.xml', xml)
  return zip.generateAsync({ type: 'uint8array' })
}

describe('SourceCatalog', () => {
  it('imports, extracts and reads EPUB evidence while preserving original bytes', async () => {
    const store = new MemoryFileStore()
    const catalog = new SourceCatalog(store)
    const bytes = await epubFixture()
    const source = await catalog.importBytes({ name: '参考.epub', bytes })
    expect(await catalog.extract(source.id)).toMatchObject({ extraction: 'ready', extractedChars: expect.any(Number) })
    expect(await catalog.readExtracted(source.id)).toContain('第一章')
    expect(await store.readBytes(source.relativePath)).toEqual(bytes)
  })

  it('discovers hand-placed library files without rewriting them', async () => {
    const store = new MemoryFileStore()
    const original = new Uint8Array([0xef, 0xbb, 0xbf, 0xe5, 0x8f, 0x82])
    await store.writeBytes('inspiration/参考/设定.md', original)

    const sources = await new SourceCatalog(store).list()

    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({
      relativePath: 'inspiration/参考/设定.md',
      displayName: '设定.md',
      origin: 'library',
      size: original.byteLength,
      extraction: 'ready'
    })
    expect(await store.readBytes('inspiration/参考/设定.md')).toEqual(original)
    expect(await store.readText('.storyfabric/inspiration/catalog.json')).toBeNull()
  })

  it('rejects import paths that escape the imported source directory', async () => {
    const catalog = new SourceCatalog(new MemoryFileStore())

    await expect(catalog.importBytes({ name: '../outside.txt', bytes: new Uint8Array([1]) })).rejects.toSatisfy((error: unknown) => errorCode(error) === 'INVALID_PATH')
    await expect(catalog.importBytes({ name: 'C:\\outside.txt', bytes: new Uint8Array([1]) })).rejects.toSatisfy((error: unknown) => errorCode(error) === 'INVALID_PATH')
  })

  it('enforces per-source and aggregate raw byte caps before writing imports', async () => {
    const store = new MemoryFileStore()
    const catalog = new SourceCatalog(store)

    await expect(catalog.importBytes({ name: 'large.txt', bytes: new Uint8Array(MAX_INSPIRATION_SOURCE_BYTES + 1) })).rejects.toSatisfy((error: unknown) => errorCode(error) === 'TOO_LARGE')
    await store.writeBytes('inspiration/existing.txt', new Uint8Array(MAX_INSPIRATION_TOTAL_BYTES))
    await expect(catalog.importBytes({ name: 'next.txt', bytes: new Uint8Array([1]) })).rejects.toSatisfy((error: unknown) => errorCode(error) === 'TOO_LARGE')
    expect(await store.listDirs('inspiration/imported')).toEqual([])
  })

  it('never removes a hand-placed library source', async () => {
    const store = new MemoryFileStore()
    await store.writeText('inspiration/library.txt', 'keep me')
    const catalog = new SourceCatalog(store)
    const [library] = await catalog.list()

    await expect(catalog.removeImported(library.id)).rejects.toSatisfy((error: unknown) => errorCode(error) === 'INVALID_PATH')
    expect(await store.readText('inspiration/library.txt')).toBe('keep me')
  })

  it('does not recursively delete later hand content when an imported source path becomes a directory', async () => {
    const store = new MemoryFileStore()
    const catalog = new SourceCatalog(store)
    const source = await catalog.importBytes({ name: 'replaceable.txt', bytes: new TextEncoder().encode('original') })
    await store.remove(source.relativePath)
    await store.ensureDir(source.relativePath)
    await store.writeText(`${source.relativePath}/hand-note.txt`, 'preserve')

    await expect(catalog.removeImported(source.id)).rejects.toThrow()
    expect(await store.readText(`${source.relativePath}/hand-note.txt`)).toBe('preserve')
  })

  it('classifies an over-limit library file from metadata without reading its bytes', async () => {
    class MetadataOnlyStore extends MemoryFileStore {
      override async listFiles(dir: string): Promise<string[]> {
        return dir === 'inspiration' ? ['huge.txt'] : super.listFiles(dir)
      }

      async fileSize(path: string): Promise<number | null> {
        return path === 'inspiration/huge.txt' ? MAX_INSPIRATION_SOURCE_BYTES + 1 : null
      }

      override async readBytes(path: string): Promise<Uint8Array | null> {
        if (path === 'inspiration/huge.txt') throw new Error('must not read a known oversized library file')
        return super.readBytes(path)
      }
    }
    const catalog = new SourceCatalog(new MetadataOnlyStore())

    await expect(catalog.list()).resolves.toEqual([expect.objectContaining({
      relativePath: 'inspiration/huge.txt',
      size: MAX_INSPIRATION_SOURCE_BYTES + 1,
      extraction: 'too-large'
    })])
  })

  it('treats an unprovenanced imported directory as a library file and never deletes it by directory id', async () => {
    const store = new MemoryFileStore()
    await store.writeText('inspiration/imported/manual_drop/reference.txt', 'keep me too')
    const catalog = new SourceCatalog(store)

    const [source] = await catalog.list()

    expect(source).toMatchObject({
      relativePath: 'inspiration/imported/manual_drop/reference.txt',
      origin: 'library'
    })
    await expect(catalog.removeImported('manual_drop')).rejects.toSatisfy((error: unknown) => errorCode(error) === 'NOT_FOUND')
    expect(await store.readText('inspiration/imported/manual_drop/reference.txt')).toBe('keep me too')
  })

  it('invalidates stale extracted text when the source changes', async () => {
    const store = new MemoryFileStore()
    const catalog = new SourceCatalog(store)
    const source = await catalog.importBytes({ name: 'notes.txt', bytes: new TextEncoder().encode('before') })

    await catalog.extract(source.id)
    expect(await catalog.readExtracted(source.id)).toBe('before')
    await store.writeBytes(source.relativePath, new TextEncoder().encode('after'))

    await expect(catalog.readExtracted(source.id)).rejects.toSatisfy((error: unknown) => errorCode(error) === 'SOURCE_CHANGED')
    expect(await store.readText(`.storyfabric/inspiration/extracted/${source.id}.json`)).toBeNull()
  })

  it('bounds model-facing reads to the requested safe character slice', async () => {
    const catalog = new SourceCatalog(new MemoryFileStore())
    const source = await catalog.importBytes({ name: 'long.txt', bytes: new TextEncoder().encode('abcdefghij') })
    await catalog.extract(source.id)

    expect(await catalog.readExtracted(source.id, { maxChars: 4 })).toBe('abcd')
    await expect(catalog.readExtracted(source.id, { maxChars: 80_001 })).rejects.toSatisfy((error: unknown) => errorCode(error) === 'TOO_LARGE')
  })

  it('does not cache extracted text above the 10,000,000 character index cap', async () => {
    const store = new MemoryFileStore()
    const catalog = new SourceCatalog(store)
    const source = await catalog.importBytes({ name: 'oversized.md', bytes: new TextEncoder().encode('x'.repeat(10_000_001)) })

    await expect(catalog.extract(source.id)).resolves.toMatchObject({ extraction: 'too-large' })
    expect(await store.readText(`.storyfabric/inspiration/extracted/${source.id}.json`)).toBeNull()
    await expect(catalog.readExtracted(source.id)).rejects.toSatisfy((error: unknown) => errorCode(error) === 'TOO_LARGE')
  })

  it('records a corrupt PDF as unsupported without creating extracted text', async () => {
    const store = new MemoryFileStore()
    const catalog = new SourceCatalog(store)
    const source = await catalog.importBytes({ name: 'broken.pdf', bytes: new Uint8Array([37, 80, 68, 70, 45]) })

    await expect(catalog.extract(source.id)).resolves.toMatchObject({ extraction: 'unsupported' })
    expect(await store.readText(`.storyfabric/inspiration/extracted/${source.id}.json`)).toBeNull()
    await expect(catalog.readExtracted(source.id)).rejects.toSatisfy((error: unknown) => errorCode(error) === 'UNSUPPORTED')
  })

  it('does not cache DOCX sources with unbound prefixes or invalid attribute entities', async () => {
    const store = new MemoryFileStore()
    const catalog = new SourceCatalog(store)
    const badXml = [
      '<w:document><w:body><w:p><w:r><w:t>forged</w:t></w:r></w:p></w:body></w:document>',
      '<w:document xmlns:w="urn:test" x="&broken;"><w:body><w:p><w:r><w:t>forged</w:t></w:r></w:p></w:body></w:document>'
    ]

    for (const [index, xml] of badXml.entries()) {
      const source = await catalog.importBytes({ name: `invalid-${index}.docx`, bytes: await docxBytes(xml) })
      await expect(catalog.extract(source.id)).resolves.toMatchObject({ extraction: 'unsupported' })
      expect(await store.readText(`.storyfabric/inspiration/extracted/${source.id}.json`)).toBeNull()
    }
  })

  it('serializes concurrent imports so their aggregate raw bytes and provenance stay within the cap', async () => {
    const store = new MemoryFileStore()
    const catalog = new SourceCatalog(store)
    const input = new Uint8Array(26 * 1024 * 1024)

    const results = await Promise.allSettled(Array.from({ length: 4 }, (_, index) => catalog.importBytes({ name: `parallel-${index}.txt`, bytes: input })))

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(3)
    expect(results.filter((result) => result.status === 'rejected').every((result) => result.status !== 'rejected' || errorCode(result.reason) === 'TOO_LARGE')).toBe(true)
    const catalogFile = JSON.parse(await store.readText('.storyfabric/inspiration/catalog.json') ?? '{}') as { imported?: Record<string, unknown> }
    expect(Object.keys(catalogFile.imported ?? {})).toHaveLength(3)
    expect((await catalog.list()).filter((source) => source.origin === 'imported').reduce((total, source) => total + source.size, 0)).toBeLessThanOrEqual(MAX_INSPIRATION_TOTAL_BYTES)
  })

  it('rejects extraction and cache reads when the source changes during their revision checks', async () => {
    class ChangingStore extends MemoryFileStore {
      sourcePath = ''
      sourceReads = 0
      changeOnRead = 0
      changeDuringCacheRead = false

      override async readBytes(path: string): Promise<Uint8Array | null> {
        if (path === this.sourcePath) {
          this.sourceReads += 1
          if (this.sourceReads === this.changeOnRead) await super.writeBytes(path, new TextEncoder().encode('after'))
        }
        return super.readBytes(path)
      }

      override async readText(path: string): Promise<string | null> {
        const value = await super.readText(path)
        if (this.changeDuringCacheRead && path.startsWith('.storyfabric/inspiration/extracted/')) {
          this.changeDuringCacheRead = false
          await super.writeBytes(this.sourcePath, new TextEncoder().encode('after-read'))
        }
        return value
      }
    }
    const store = new ChangingStore()
    const catalog = new SourceCatalog(store)
    const source = await catalog.importBytes({ name: 'changing.txt', bytes: new TextEncoder().encode('before') })
    store.sourcePath = source.relativePath
    store.changeOnRead = 3 // discover, extract, then the required pre-commit recheck

    await expect(catalog.extract(source.id)).rejects.toSatisfy((error: unknown) => errorCode(error) === 'SOURCE_CHANGED')
    expect(await store.readText(`.storyfabric/inspiration/extracted/${source.id}.json`)).toBeNull()

    store.changeOnRead = 0
    await catalog.extract(source.id)
    store.changeDuringCacheRead = true
    await expect(catalog.readExtracted(source.id)).rejects.toSatisfy((error: unknown) => errorCode(error) === 'SOURCE_CHANGED')
  })
})
