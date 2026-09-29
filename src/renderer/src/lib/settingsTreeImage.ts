import { SETTING_NODE_HEIGHT, SETTING_NODE_WIDTH, type SettingsTreeGraph } from './settingsTree'

const PADDING = 48
const MIN_WIDTH = 320
const MIN_HEIGHT = 180
// Keep PNG canvases within a conservative mobile browser texture limit.
const MAX_CANVAS_DIMENSION = 4096
const TITLE_FONT_SIZE = 16
const TITLE_WIDTH = SETTING_NODE_WIDTH - 32
const MAX_TITLE_UNITS = TITLE_WIDTH / TITLE_FONT_SIZE

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

export function settingsTreeSvg(graph: SettingsTreeGraph): { svg: string; width: number; height: number } {
  const width = Math.max(MIN_WIDTH, Math.ceil(graph.width + PADDING * 2))
  const height = Math.max(MIN_HEIGHT, Math.ceil(graph.height + PADDING * 2))
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]))
  const paths = graph.edges.flatMap((edge) => {
    const source = nodesById.get(edge.source)
    const target = nodesById.get(edge.target)
    if (!source || !target) return []
    const fromX = source.position.x + SETTING_NODE_WIDTH + PADDING
    const fromY = source.position.y + SETTING_NODE_HEIGHT / 2 + PADDING
    const toX = target.position.x + PADDING
    const toY = target.position.y + SETTING_NODE_HEIGHT / 2 + PADDING
    const middleX = (fromX + toX) / 2
    return [`<path d="M ${fromX} ${fromY} H ${middleX} V ${toY} H ${toX}" fill="none" stroke="#a8a29e" stroke-width="2" stroke-linejoin="round"/>`]
  })
  const nodes = graph.nodes.map((node, index) => {
    const x = node.position.x + PADDING
    const y = node.position.y + PADDING
    const category = node.category === 'background' ? '背景设定' : '其他设定'
    const meta = `${category} · ${node.tags.length} 个标签`
    const titleClipId = `setting-title-${index}`
    return [
      `<rect x="${x}" y="${y}" width="${SETTING_NODE_WIDTH}" height="${SETTING_NODE_HEIGHT}" rx="12" fill="#ffffff" stroke="#d6d3d1" stroke-width="1.5"/>`,
      `<clipPath id="${titleClipId}"><rect x="${x + 16}" y="${y + 13}" width="${TITLE_WIDTH}" height="30"/></clipPath>`,
      `<text x="${x + 16}" y="${y + 36}" clip-path="url(#${titleClipId})" fill="#292524" font-size="${TITLE_FONT_SIZE}" font-weight="600" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif"><tspan>${escapeXml(clampedTitle(node.title))}</tspan></text>`,
      `<text x="${x + 16}" y="${y + 65}" fill="#78716c" font-size="12" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif">${escapeXml(meta)}</text>`
    ].join('')
  })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#faf8f3"/>${paths.join('')}${nodes.join('')}</svg>`
  return { svg, width, height }
}

export async function settingsTreePngFile(graph: SettingsTreeGraph, fileName: string): Promise<File> {
  const { svg, width, height } = settingsTreeSvg(graph)
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
