import { afterEach, describe, expect, it, vi } from 'vitest'
import { settingsTreePngFile, settingsTreeSvg } from './settingsTreeImage'
import { buildSettingsTree } from './settingsTree'
import type { SettingsTreeGraph } from './settingsTree'

const graph: SettingsTreeGraph = {
  nodes: [
    { id: 'root', title: '世界 & <起源>', category: 'background', tags: ['史诗'], depth: 0, position: { x: 0, y: 0 } },
    { id: 'child', title: '山 > 河', category: 'other', tags: [], parentId: 'root', depth: 1, position: { x: 292, y: 132 } }
  ],
  edges: [{ id: 'setting:root:child', source: 'root', target: 'child' }],
  width: 516,
  height: 224,
  warnings: []
}

describe('settingsTreeSvg', () => {
  it('exports nested tag nodes and their connecting edges', () => {
    const nested = buildSettingsTree([{ id: 'world', title: '世界观', category: 'background', tags: ['势力', '哈夫克'], tagParents: { 哈夫克: '势力' } }])
    const { svg } = settingsTreeSvg(nested)

    expect(svg).toContain('势力')
    expect(svg).toContain('哈夫克')
    expect(svg.match(/<path\b/g)).toHaveLength(2)
    expect(svg.match(/>标签<\/text>/g)).toHaveLength(2)
  })
  it('escapes dynamic text and includes every node and edge within the image bounds', () => {
    const { svg, width, height } = settingsTreeSvg(graph)

    expect(svg).toContain('世界 &amp; &lt;起源&gt;')
    expect(svg).toContain('山 &gt; 河')
    expect(svg).not.toContain('世界 & <起源>')
    expect(svg.match(/<rect x="[^"]+" y="[^"]+" width="224" height="92"/g)).toHaveLength(2)
    expect(svg.match(/<path\b/g)).toHaveLength(1)
    expect(width).toBeGreaterThan(graph.width)
    expect(height).toBeGreaterThan(graph.height)
    expect(svg).toContain(`width="${width}" height="${height}"`)
  })

  it('returns a fixed minimum image for an empty tree', () => {
    const result = settingsTreeSvg({ nodes: [], edges: [], width: 0, height: 0, warnings: [] })

    expect(result.width).toBeGreaterThanOrEqual(320)
    expect(result.height).toBeGreaterThanOrEqual(180)
    expect(result.svg).toContain('<svg')
    expect(result.svg).not.toContain('<path')
  })

  it('ellipsizes long titles and clips the text to the node interior', () => {
    const longTitle = '超'.repeat(30)
    const { svg } = settingsTreeSvg({
      ...graph,
      nodes: [{ ...graph.nodes[0], title: longTitle }],
      edges: []
    })

    expect(svg).toContain(`<tspan>${'超'.repeat(11)}…</tspan>`)
    expect(svg).not.toContain(longTitle)
    expect(svg).toContain('<clipPath id="setting-title-0"><rect x="64" y="61" width="192" height="30"/></clipPath>')
    expect(svg).toContain('clip-path="url(#setting-title-0)"')
  })
})

describe('settingsTreePngFile', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('draws the complete SVG at export dimensions and returns a PNG file', async () => {
    const createObjectURL = vi.fn(() => 'blob:tree')
    const revokeObjectURL = vi.fn()
    const drawImage = vi.fn()
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob: (callback: (blob: Blob) => void) => callback(new Blob(['png'], { type: 'image/png' }))
    }
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    class LoadedImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) { this.onload?.() }
    }
    vi.stubGlobal('Image', LoadedImage)
    vi.stubGlobal('document', { createElement: () => canvas })

    const file = await settingsTreePngFile(graph, '设定图谱.png')

    expect(file.name).toBe('设定图谱.png')
    expect(file.type).toBe('image/png')
    expect(canvas.width).toBeGreaterThan(graph.width)
    expect(canvas.height).toBeGreaterThan(graph.height)
    expect(drawImage).toHaveBeenCalledWith(expect.any(LoadedImage), 0, 0, canvas.width, canvas.height)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:tree')
  })

  it('scales an oversized tree into a bounded canvas without cropping its SVG', async () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:large-tree')
    const drawImage = vi.fn()
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob: (callback: (blob: Blob) => void) => callback(new Blob(['png'], { type: 'image/png' }))
    }
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() })
    class LoadedImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) { this.onload?.() }
    }
    vi.stubGlobal('Image', LoadedImage)
    vi.stubGlobal('document', { createElement: () => canvas })
    const largeGraph: SettingsTreeGraph = {
      ...graph,
      nodes: [...graph.nodes, { ...graph.nodes[1], id: 'far', title: '远端节点', position: { x: 19_700, y: 9_900 } }],
      width: 20_000,
      height: 10_000
    }

    await settingsTreePngFile(largeGraph, '大图.png')

    const { width, height } = settingsTreeSvg(largeGraph)
    expect(canvas.width).toBe(4096)
    expect(canvas.height).toBe(Math.floor(height * 4096 / width))
    expect(canvas.height).toBeLessThanOrEqual(4096)
    expect(drawImage).toHaveBeenCalledWith(expect.any(LoadedImage), 0, 0, canvas.width, canvas.height)
    const svgBlob = createObjectURL.mock.calls[0][0] as Blob
    expect(await svgBlob.text()).toContain('远端节点')
    expect(await svgBlob.text()).toContain(`viewBox="0 0 ${width} ${height}"`)
  })

  it('turns canvas draw failures into a readable export error and releases the SVG URL', async () => {
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:tree', revokeObjectURL })
    class LoadedImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) { this.onload?.() }
    }
    vi.stubGlobal('Image', LoadedImage)
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => { throw new Error('SecurityError') } })
      })
    })

    await expect(settingsTreePngFile(graph, '设定图谱.png')).rejects.toThrow('无法绘制设定图谱图片')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:tree')
  })
})
