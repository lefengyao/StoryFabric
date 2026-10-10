import type { ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { getFontEmbedCSS, toCanvas } from 'html-to-image'
import { ImageExportSizeError, planRaster } from './rasterPlan'

export interface ImageExportResult { blobs: Blob[]; width: number; height: number; scale: number }
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
const isMobile = () => Boolean(window.Capacitor?.isNativePlatform?.()) || /Android|iPhone|iPad/i.test(navigator.userAgent)

async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`${label}等待超时，请检查资源地址后重试`)), 30000) })]) }
  finally { if (timer) clearTimeout(timer) }
}

async function assetsReady(node: HTMLElement): Promise<void> {
  if (document.fonts) await bounded(document.fonts.ready, '字体')
  await Promise.all([...node.querySelectorAll('img')].map(async (image) => {
    if (image.complete && image.naturalWidth > 0) return
    await bounded(image.decode(), '正文图片').catch(() => { throw new Error('正文中的图片无法加载，请检查图片地址后重试') })
  }))
  await frame()
  await frame()
}

function isolation(width: number): HTMLDivElement {
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.inert = true
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;pointer-events:none;z-index:-1;`
  document.body.append(host)
  return host
}

function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob && blob.size > 100 ? resolve(blob) : reject(new Error('当前设备无法编码完整 PNG，请缩小范围或分成多张')), 'image/png'))
}

async function raster(node: HTMLElement, split: boolean): Promise<ImageExportResult> {
  await assetsReady(node)
  const width = Math.ceil(Math.max(node.scrollWidth, node.getBoundingClientRect().width))
  const height = Math.ceil(Math.max(node.scrollHeight, node.getBoundingClientRect().height))
  const mobile = isMobile()
  let plan: ReturnType<typeof planRaster>
  try { plan = planRaster(width, height, mobile) }
  catch (error) {
    if (!(error instanceof ImageExportSizeError) || !split) throw error
    // Explicit multi-image mode retains original readable dimensions.
    plan = { ...planRaster(width, Math.min(height, 2048), mobile), cssHeight: height, height, tiles: [] }
    for (let y = 0; y < height; y += 2048) plan.tiles.push({ y, height: Math.min(2048, height - y) })
  }
  if (split && height > 2048) {
    plan.tiles = []
    for (let y = 0; y < height; y += 2048) plan.tiles.push({ y, height: Math.min(2048, height - y) })
  }
  const backgroundColor = getComputedStyle(node).backgroundColor
  const background = !backgroundColor || backgroundColor === 'rgba(0, 0, 0, 0)' ? getComputedStyle(document.body).backgroundColor || '#fff' : backgroundColor
  const fontEmbedCSS = await getFontEmbedCSS(node)
  const destination = split ? null : document.createElement('canvas')
  const blobs: Blob[] = []
  const abort = new AbortController()
  const timeout = setTimeout(() => abort.abort(), 60000)
  try {
    if (destination) { destination.width = plan.width; destination.height = plan.height }
    const context = destination?.getContext('2d')
    if (destination && !context) throw new Error('当前设备不支持 PNG 绘制')
    if (context) { context.fillStyle = background; context.fillRect(0, 0, plan.width, plan.height) }
    for (const tile of plan.tiles) {
      const canvas = await toCanvas(node, {
        width: plan.cssWidth, height: tile.height, pixelRatio: plan.scale, skipAutoScale: true, fontEmbedCSS,
        backgroundColor: background, includeQueryParams: true,
        fetchRequestInit: { signal: abort.signal },
        style: { width: `${plan.cssWidth}px`, height: `${height}px`, transform: `translateY(-${tile.y}px)`, transformOrigin: 'top left', margin: '0' },
        onImageErrorHandler: () => { throw new Error('导出图片资源加载失败，请检查图片地址') }
      })
      try {
        if (canvas.width !== plan.width || canvas.height !== tile.height * plan.scale) throw new Error('设备无法绘制请求的完整尺寸，请缩小范围或分成多张')
        if (split) blobs.push(await encode(canvas))
        else context!.drawImage(canvas, 0, tile.y * plan.scale)
      } finally { canvas.width = 0; canvas.height = 0 }
    }
    if (destination) blobs.push(await encode(destination))
    return { blobs, width: plan.width, height: height * plan.scale, scale: plan.scale }
  } finally { clearTimeout(timeout); if (destination) { destination.width = 0; destination.height = 0 } }
}

export async function captureView(view: ReactNode, options: { width?: number; split?: boolean } = {}): Promise<ImageExportResult> {
  const host = isolation(options.width ?? 760)
  const root = createRoot(host)
  try {
    flushSync(() => root.render(view))
    const node = host.firstElementChild
    if (!(node instanceof HTMLElement)) throw new Error('没有可导出的资料')
    return await raster(node, Boolean(options.split))
  } finally { root.unmount(); host.remove() }
}

/** Clone once before awaiting any assets: refreshed state cannot alter the export dataset. */
export async function captureElement(source: HTMLElement, split = false, heading?: string): Promise<ImageExportResult> {
  const sourceElements = [source, ...source.querySelectorAll<HTMLElement>('*')]
  const clone = source.cloneNode(true) as HTMLElement
  const clonedElements = [clone, ...clone.querySelectorAll<HTMLElement>('*')]
  const bounds = source.getBoundingClientRect()
  const paddingRight = Number.parseFloat(getComputedStyle(source).paddingRight) || 0
  const width = Math.ceil(Math.max(bounds.width, ...sourceElements.map((element) => Math.max(0, element.getBoundingClientRect().left - bounds.left) + element.scrollWidth + paddingRight)))
  const host = isolation(width)
  try {
    sourceElements.forEach((element, index) => {
      const target = clonedElements[index]
      const style = getComputedStyle(element)
      // Preserve inherited theme variables and current page styles in the isolated tree.
      for (const name of style) target.style.setProperty(name, style.getPropertyValue(name), style.getPropertyPriority(name))
      if (/auto|scroll|hidden/.test(`${style.overflowX} ${style.overflowY}`)) {
        target.style.overflow = 'visible'; target.style.maxHeight = 'none'; target.style.maxWidth = 'none'; target.style.height = 'auto'
      }
      if (style.position === 'sticky') target.style.position = 'static'
      if (element instanceof HTMLCanvasElement && target instanceof HTMLCanvasElement) target.getContext('2d')?.drawImage(element, 0, 0)
      if (element instanceof HTMLSelectElement) {
        const span = document.createElement('span'); span.textContent = element.selectedOptions[0]?.textContent ?? element.value; span.style.cssText = target.style.cssText; target.replaceWith(span)
      } else if (element instanceof HTMLInputElement) {
        const span = document.createElement('span'); span.textContent = element.value; span.style.cssText = target.style.cssText; target.replaceWith(span)
      }
    })
    clone.querySelectorAll('[data-image-export-action]').forEach((element) => element.remove())
    if (heading && clone.querySelector('h1')) clone.querySelector('h1')!.textContent = heading
    // Data-bearing buttons (model names and chart bars) keep their contents and current styling.
    clone.querySelectorAll('button').forEach((button) => { const span = document.createElement('span'); span.style.cssText = button.style.cssText; span.replaceChildren(...button.childNodes); button.replaceWith(span) })
    clone.style.width = `${width}px`; clone.style.maxWidth = 'none'; clone.style.height = 'auto'; clone.style.overflow = 'visible'
    clone.style.background = getComputedStyle(document.body).backgroundColor
    host.append(clone)
    return await raster(clone, split)
  } finally { host.remove() }
}
