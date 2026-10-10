import { SETTING_NODE_HEIGHT, SETTING_NODE_WIDTH, wrapSettingsTreeText, type SettingsTreeGraph } from './settingsTree'

const PADDING = 48
const MIN_WIDTH = 320
const MIN_HEIGHT = 180
// Keep PNG canvases within a conservative mobile browser texture limit.
const MAX_CANVAS_DIMENSION = 4096
const TITLE_FONT_SIZE = 16
const TITLE_WIDTH = SETTING_NODE_WIDTH - 32
const MAX_TITLE_UNITS = TITLE_WIDTH / TITLE_FONT_SIZE
const ACCENT = '#f5b400'

export interface SettingsTreeImageOptions {
  includeNotes?: boolean
  detailsByNodeId?: Record<string, string>
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char] ?? char)
}

function titleUnit(char: string): number {
  if (/[\u3000-\u9fff\uff00-\uffef]/u.test(char)) return 1
  if (/[MW@#%&]/u.test(char)) return 0.9
  return 0.65
}

function clampedTitle(title: string): string {
  const chars = Array.from(title)
  if (chars.reduce((width, char) => width + titleUnit(char), 0) <= MAX_TITLE_UNITS) return title
  let width = 0
  let result = ''
  for (const char of chars) {
    const nextWidth = width + titleUnit(char)
    if (nextWidth > MAX_TITLE_UNITS - 1) break
    result += char
    width = nextWidth
  }
  return `${result}…`
}

export function settingsTreeSvg(graph: SettingsTreeGraph, options: SettingsTreeImageOptions = {}): { svg: string; width: number; height: number } {
  const width = Math.max(MIN_WIDTH, Math.ceil(graph.width + PADDING * 2))
  const chartHeight = Math.max(MIN_HEIGHT, Math.ceil(graph.height + PADDING * 2))
  const noteWidth = Math.max(12, (width - PADDING * 2 - 24) / 14)
  const notes = options.includeNotes ? graph.nodes.flatMap((node) => {
    const detail = options.detailsByNodeId?.[node.id] ?? node.content
    return detail?.trim() ? [{ node, lines: wrapSettingsTreeText(detail, noteWidth) }] : []
  }) : []
  const notesHeight = notes.length ? 102 + notes.reduce((total, note) => total + 34 + note.lines.length * 21 + 18, 0) : 0
  const height = chartHeight + notesHeight
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]))
  const paths = graph.edges.flatMap((edge) => {
    const source = nodesById.get(edge.source)
    const target = nodesById.get(edge.target)
    if (!source || !target) return []
    const fromX = source.position.x + SETTING_NODE_WIDTH + PADDING
    const fromY = source.position.y + (source.depth === 0 ? (source.height ?? SETTING_NODE_HEIGHT) / 2 : (source.height ?? SETTING_NODE_HEIGHT) - 12) + PADDING
    const toX = target.position.x + PADDING
    const toY = target.position.y + (target.depth === 0 ? (target.height ?? SETTING_NODE_HEIGHT) / 2 : (target.height ?? SETTING_NODE_HEIGHT) - 12) + PADDING
    const middleX = (fromX + toX) / 2
    return [`<path d="M ${fromX} ${fromY} C ${middleX} ${fromY}, ${middleX} ${toY}, ${toX} ${toY}" fill="none" stroke="${ACCENT}" stroke-width="2.5"/>`]
  })
  const nodes = graph.nodes.map((node, index) => {
    const x = node.position.x + PADDING
    const y = node.position.y + PADDING
    const titleClipId = `setting-title-${index}`
    const summary = node.summary ? wrapSettingsTreeText(node.summary) : []
    const nodeHeight = node.height ?? SETTING_NODE_HEIGHT
    return [
      node.depth === 0 ? `<rect x="${x}" y="${y + 16}" width="${SETTING_NODE_WIDTH}" height="${nodeHeight - 32}" rx="7" fill="${ACCENT}"/>` : `<path d="M ${x} ${y + nodeHeight - 12} H ${x + SETTING_NODE_WIDTH}" fill="none" stroke="${ACCENT}" stroke-width="2"/>`,
      `<clipPath id="${titleClipId}"><rect x="${x + 16}" y="${y + 13}" width="${TITLE_WIDTH}" height="30"/></clipPath>`,
      `<text x="${x + 16}" y="${y + 36}" clip-path="url(#${titleClipId})" fill="#292524" font-size="${TITLE_FONT_SIZE}" font-weight="600" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif"><tspan>${escapeXml(clampedTitle(node.title))}</tspan></text>`,
      summary.map((line, row) => `<text x="${x + 16}" y="${y + 57 + row * 18}" fill="#57534e" font-size="13" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif">${escapeXml(line)}</text>`).join('')
    ].join('')
  })
  let noteY = chartHeight + 80
  const noteElements = notes.map(({ node, lines }, index) => {
    const start = noteY
    noteY += 34 + lines.length * 21 + 18
    return `<text x="${PADDING}" y="${start}" fill="#292524" font-size="16" font-weight="600" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif">${index + 1}. ${escapeXml(node.title)}</text>${lines.map((line, row) => `<text x="${PADDING + 18}" y="${start + 29 + row * 21}" fill="#44403c" font-size="14" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif">${escapeXml(line)}</text>`).join('')}`
  })
  const noteHeader = notes.length ? `<path d="M ${PADDING} ${chartHeight + 12} H ${width - PADDING}" stroke="${ACCENT}" stroke-width="2"/><text x="${PADDING}" y="${chartHeight + 38}" fill="#292524" font-size="18" font-weight="600" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif">详细批注</text>` : ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#ffffff"/>${paths.join('')}${nodes.join('')}${noteHeader}${noteElements.join('')}</svg>`
  return { svg, width, height }
}

export async function settingsTreePngFile(graph: SettingsTreeGraph, fileName: string, options: SettingsTreeImageOptions = {}): Promise<File> {
  const { svg, width, height } = settingsTreeSvg(graph, options)
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const next = new Image()
      next.onload = () => resolve(next)
      next.onerror = () => reject(new Error('无法加载设定图谱图片'))
      next.src = url
    })
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, MAX_CANVAS_DIMENSION / Math.max(width, height))
    canvas.width = Math.max(1, Math.floor(width * scale))
    canvas.height = Math.max(1, Math.floor(height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前设备不支持图片绘制')
    try {
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
    } catch {
      throw new Error('无法绘制设定图谱图片')
    }
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error('无法生成设定图谱图片')), 'image/png')
    })
    return new File([blob], fileName, { type: 'image/png' })
  } finally {
    URL.revokeObjectURL(url)
  }
}
