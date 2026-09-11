import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workspaceRoot = resolve(__dirname, '../../../..')
const rendererIndex = readFileSync(resolve(workspaceRoot, 'src/renderer/index.html'), 'utf8')

describe('renderer favicon asset contract', () => {
  it('uses the canonical root flat logo instead of a duplicate public copy', () => {
    expect(rendererIndex).toContain('href="../../storyfabric-logo-flat.svg"')
    expect(existsSync(resolve(workspaceRoot, 'src/renderer/public/storyfabric-logo-flat.svg'))).toBe(false)
  })
})
