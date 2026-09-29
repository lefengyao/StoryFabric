import { shareFiles } from './shareFiles'

/** Render a chapter as readable PNG pages, keeping every canvas below mobile texture limits. */
const WIDTH = 1080
const MAX_HEIGHT = 9000
const MARGIN = 88
const LINE_HEIGHT = 52
const FONT = '30px "Noto Sans CJK SC", "Microsoft YaHei", sans-serif'

export function imageFileStem(title: string): string {
  return (title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 60) || '章节')
}

async function wrapText(ctx: CanvasRenderingContext2D, text: string, width: number): Promise<string[]> {
  if (!text) return ['']
  const lines: string[] = []
  let line = ''
  let position = 0
  for (const char of text) {
    if (line && ctx.measureText(line + char).width > width) {
      lines.push(line)
      line = char
    } else line += char
    if (++position % 2000 === 0) await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
  }
  if (line) lines.push(line)
  return lines
}

function makeCanvas(height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = height
  return canvas
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('无法生成章节图片')), 'image/png'))
}

export async function renderChapterImages(title: string, body: string): Promise<File[]> {
  const measureCanvas = makeCanvas(1)
  const measure = measureCanvas.getContext('2d')
  if (!measure) throw new Error('当前设备不支持图片绘制')
  measure.font = FONT
  const content: string[] = []
  for (const paragraph of body.replace(/\r\n?/g, '\n').split('\n')) content.push(...await wrapText(measure, paragraph, WIDTH - MARGIN * 2))
  const linesPerPage = Math.floor((MAX_HEIGHT - 340) / LINE_HEIGHT)
  const pages: string[][] = []
  for (let at = 0; at < content.length; at += linesPerPage) pages.push(content.slice(at, at + linesPerPage))
  if (!pages.length) pages.push([])
  const files: File[] = []
  for (let index = 0; index < pages.length; index++) {
    const lines = pages[index]
    const height = Math.max(520, Math.min(MAX_HEIGHT, 250 + lines.length * LINE_HEIGHT + 100))
    const canvas = makeCanvas(height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('当前设备不支持图片绘制')
    ctx.fillStyle = '#faf8f3'
    ctx.fillRect(0, 0, WIDTH, height)
    ctx.fillStyle = '#2b2926'
    ctx.font = 'bold 43px "Noto Sans CJK SC", "Microsoft YaHei", sans-serif'
    ctx.fillText(title, MARGIN, 112, WIDTH - MARGIN * 2)
    ctx.fillStyle = '#aaa39a'
    ctx.fillRect(MARGIN, 148, WIDTH - MARGIN * 2, 2)
    ctx.fillStyle = '#383633'
    ctx.font = FONT
    for (let line = 0; line < lines.length; line++) ctx.fillText(lines[line], MARGIN, 220 + line * LINE_HEIGHT)
    ctx.fillStyle = '#9b948a'
    ctx.font = '22px sans-serif'
    ctx.fillText(`StoryFabric · ${index + 1} / ${pages.length}`, MARGIN, height - 48)
    const blob = await toBlob(canvas)
    files.push(new File([blob], `${imageFileStem(title)}${pages.length > 1 ? `-${index + 1}` : ''}.png`, { type: 'image/png' }))
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
  }
  return files
}

export async function shareChapterImages(files: File[]): Promise<'shared' | 'downloaded'> {
  return shareFiles(files, files[0]?.name ?? '章节长图', '分享章节长图')
}
