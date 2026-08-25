// 从 resources/icon.svg 生成应用图标：Windows ICO（多尺寸）+ PNG
import { readFile, writeFile } from 'fs/promises'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const SIZES = [16, 24, 32, 48, 64, 128, 256]
const svg = await readFile(new URL('../resources/icon.svg', import.meta.url))

const buffers = []
for (const size of SIZES) {
  const buf = await sharp(svg, { density: 384 }).resize(size, size).png().toBuffer()
  if (size === 256) {
    await writeFile(new URL('../resources/icon-256.png', import.meta.url), buf)
    // 大尺寸预览图，便于人工检查
    await writeFile(new URL('../resources/icon-preview.png', import.meta.url), await sharp(svg).resize(512, 512).png().toBuffer())
  }
  buffers.push(buf)
}

const ico = await pngToIco(buffers)
await writeFile(new URL('../resources/icon.ico', import.meta.url), ico)
console.log('icons generated: resources/icon.ico, resources/icon-256.png')
