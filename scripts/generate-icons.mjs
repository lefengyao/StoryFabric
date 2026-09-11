// 从根目录的 release SVG 生成 Windows 和 Android 平台图标。
import { readFile, writeFile } from 'fs/promises'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const WINDOWS_SIZES = [16, 24, 32, 48, 64, 128, 256]
const ANDROID_SIZES = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192
}
const ANDROID_FOREGROUND_SIZES = {
  mdpi: 108,
  hdpi: 162,
  xhdpi: 216,
  xxhdpi: 324,
  xxxhdpi: 432
}
const PNG_OPTIONS = { compressionLevel: 9, adaptiveFiltering: false, force: true }
const logoUrl = new URL('../storyfabric-logo.svg', import.meta.url)
const outputUrl = (path) => new URL(`../${path}`, import.meta.url)

let svg
try {
  svg = await readFile(logoUrl)
} catch (error) {
  if (error?.code === 'ENOENT') {
    throw new Error('Canonical release SVG not found: storyfabric-logo.svg')
  }
  throw error
}

const renderLogo = (size) => sharp(svg, { density: 384 }).resize(size, size).png(PNG_OPTIONS).toBuffer()

const buffers = []
for (const size of WINDOWS_SIZES) {
  const buf = await renderLogo(size)
  if (size === 256) {
    await writeFile(outputUrl('resources/icon-256.png'), buf)
    // 大尺寸预览图，便于人工检查
    await writeFile(outputUrl('resources/icon-preview.png'), await renderLogo(512))
  }
  buffers.push(buf)
}

const ico = await pngToIco(buffers)
await writeFile(outputUrl('resources/icon.ico'), ico)

// Adaptive foreground layers use a transparent 108dp canvas. The 80dp mark keeps
// the source logo inside Android's 66dp adaptive-icon safe zone after masking.
for (const [density, size] of Object.entries(ANDROID_SIZES)) {
  const launcher = await renderLogo(size)
  await writeFile(outputUrl(`android/app/src/main/res/mipmap-${density}/ic_launcher.png`), launcher)
  await writeFile(outputUrl(`android/app/src/main/res/mipmap-${density}/ic_launcher_round.png`), launcher)

  const foregroundSize = ANDROID_FOREGROUND_SIZES[density]
  const foregroundLogo = await renderLogo(Math.round(foregroundSize * 80 / 108))
  const foreground = await sharp({
    create: {
      width: foregroundSize,
      height: foregroundSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: foregroundLogo, gravity: 'center' }])
    .png(PNG_OPTIONS)
    .toBuffer()
  await writeFile(outputUrl(`android/app/src/main/res/mipmap-${density}/ic_launcher_foreground.png`), foreground)
}

console.log('icons generated from storyfabric-logo.svg: Windows ICO/PNG + Android launcher assets')
