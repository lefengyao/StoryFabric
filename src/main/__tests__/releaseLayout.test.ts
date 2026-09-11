import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workspaceRoot = resolve(import.meta.dirname, '../../..')

describe('version-scoped release layout', () => {
  it('writes build outputs and server bundles under release/<version>', () => {
    const builderConfig = readFileSync(resolve(workspaceRoot, 'electron-builder.yml'), 'utf8')
    const bundleScript = readFileSync(resolve(workspaceRoot, 'scripts/build-server-bundle.mjs'), 'utf8')

    expect(builderConfig).toContain('output: release/${version}')
    expect(builderConfig).toContain('from: release/${version}/storyfabric-server-${version}.tar.gz')
    expect(bundleScript).toContain('const versionDir = join(releaseDir, version)')
    expect(bundleScript).toContain("const stage = join(versionDir, 'server-bundle')")
    expect(bundleScript).toContain('const outFile = join(versionDir, `storyfabric-server-${version}.tar.gz`)')
  })
})
