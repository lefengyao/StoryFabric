import { existsSync, readFileSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

const workspaceRoot = resolve(__dirname, '../../..')
const logoPath = resolve(workspaceRoot, 'storyfabric-logo.svg')
const generatorPath = resolve(workspaceRoot, 'scripts/generate-icons.mjs')

const densitySizes = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192
} as const

const foregroundSizes = {
  mdpi: 108,
  hdpi: 162,
  xhdpi: 216,
  xxhdpi: 324,
  xxxhdpi: 432
} as const

const pngOptions = { compressionLevel: 9, adaptiveFiltering: false, force: true } as const

const pngDigest = async (path: string): Promise<string> => createHash('sha256').update(await readFile(path)).digest('hex')

describe('platform icon asset contract', () => {
  it('generates platform assets from the canonical release SVG', async () => {
    const generator = readFileSync(generatorPath, 'utf8')
    expect(generator).toContain("../storyfabric-logo.svg")
    expect(generator).not.toContain("../resources/icon.svg")
    expect(existsSync(logoPath)).toBe(true)

    const logo = await readFile(logoPath)
    const expected256 = await sharp(logo, { density: 384 }).resize(256, 256).png(pngOptions).toBuffer()
    expect(await pngDigest(resolve(workspaceRoot, 'resources/icon-256.png'))).toBe(createHash('sha256').update(expected256).digest('hex'))

    const preview = await sharp(resolve(workspaceRoot, 'resources/icon-preview.png')).metadata()
    expect(preview.width).toBe(512)
    expect(preview.height).toBe(512)
  })

  it('keeps the Windows ICO multi-size payload valid', async () => {
    const ico = await readFile(resolve(workspaceRoot, 'resources/icon.ico'))
    expect(ico.length).toBeGreaterThan(64)
    expect(ico.readUInt16LE(0)).toBe(0)
    expect(ico.readUInt16LE(2)).toBe(1)
    expect(ico.readUInt16LE(4)).toBe(7)

    for (let index = 0; index < 7; index += 1) {
      const entry = 6 + index * 16
      const payloadSize = ico.readUInt32LE(entry + 8)
      const payloadOffset = ico.readUInt32LE(entry + 12)
      expect(payloadSize).toBeGreaterThan(0)
      expect(payloadOffset + payloadSize).toBeLessThanOrEqual(ico.length)
    }
  })

  it('contains non-empty Android launcher assets at project density sizes', async () => {
    for (const [density, size] of Object.entries(densitySizes)) {
      for (const name of ['ic_launcher', 'ic_launcher_round']) {
        const path = resolve(workspaceRoot, `android/app/src/main/res/mipmap-${density}/${name}.png`)
        expect(statSync(path).size).toBeGreaterThan(0)
        const metadata = await sharp(path).metadata()
        expect(metadata.width).toBe(size)
        expect(metadata.height).toBe(size)
      }

      const foregroundPath = resolve(workspaceRoot, `android/app/src/main/res/mipmap-${density}/ic_launcher_foreground.png`)
      expect(statSync(foregroundPath).size).toBeGreaterThan(0)
      const foreground = await sharp(foregroundPath).metadata()
      expect(foreground.width).toBe(foregroundSizes[density as keyof typeof foregroundSizes])
      expect(foreground.height).toBe(foregroundSizes[density as keyof typeof foregroundSizes])
    }
  })

  it('keeps normal and round adaptive icons on the canonical foreground/background', () => {
    for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
      const xml = readFileSync(resolve(workspaceRoot, `android/app/src/main/res/mipmap-anydpi-v26/${name}`), 'utf8')
      expect(xml).toContain('@color/ic_launcher_background')
      expect(xml).toContain('@mipmap/ic_launcher_foreground')
    }

    const background = readFileSync(resolve(workspaceRoot, 'android/app/src/main/res/values/ic_launcher_background.xml'), 'utf8')
    expect(background).toContain('#141D3A')
  })
})
