export class ImageExportSizeError extends Error {
  constructor(width: number, height: number) {
    super(`图片范围为 ${width} × ${height} 像素，超过当前设备的单图尺寸或内存限制。请缩小导出范围，或选择分成多张 PNG；不会截断正文。`)
    this.name = 'ImageExportSizeError'
  }
}

/** Conservative budgets include the destination RGBA canvas and one active raster tile. */
export function planRaster(width: number, height: number, mobile: boolean) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('导出内容没有有效尺寸')
  width = Math.ceil(width)
  height = Math.ceil(height)
  const maxDimension = mobile ? 8192 : 16384
  const maxPixels = mobile ? 12_000_000 : 32_000_000
  const fits = (scale: number) => width * scale <= maxDimension && height * scale <= maxDimension && width * height * scale * scale <= maxPixels
  const scale = fits(2) ? 2 : fits(1) ? 1 : 0
  if (!scale) throw new ImageExportSizeError(width, height)
  const tileHeight = Math.max(1, Math.min(2048, Math.floor(4_000_000 / (width * scale * scale))))
  const tiles: Array<{ y: number; height: number }> = []
  for (let y = 0; y < height; y += tileHeight) tiles.push({ y, height: Math.min(tileHeight, height - y) })
  return { width: width * scale, height: height * scale, cssWidth: width, cssHeight: height, scale, tiles }
}

export function imageFileName(workspaceName: string, title: string, date = new Date()): string {
  const safe = (value: string) => value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 70) || '未命名'
  const stamp = date.toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\.\d{3}Z$/, 'Z')
  return `${safe(workspaceName)}-${safe(title)}-${stamp}.png`
}
