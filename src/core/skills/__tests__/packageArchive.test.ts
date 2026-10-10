import JSZip from 'jszip'
import { expect, it } from 'vitest'
import { decodeContentPackageArchive } from '../packageArchive'

const manifest = {
  schemaVersion: 1,
  id: 'qa.package-archive',
  version: '1.0.0',
  name: '归档 Skill',
  description: '用于验证第三方内容包归档。',
  author: 'QA',
  license: 'MIT',
  minAppVersion: '0.1.5',
  platforms: ['windows', 'web', 'android'],
  skills: [{ id: 'archive-style', path: 'skills/archive-style/SKILL.md' }],
  ruleSets: []
}

it('reads and validates a declarative third-party Skill ZIP package', async () => {
  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify(manifest))
  zip.file('skills/archive-style/SKILL.md', '---\nid: archive-style\nname: 归档 Skill\nstages: [write]\ninputKind: prose-or-brief\noutputKind: guidance-or-prose\n---\n保持叙述简洁。')

  const result = await decodeContentPackageArchive(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }))

  expect(result.manifest.id).toBe('qa.package-archive')
  expect(result.files).toEqual([expect.objectContaining({ path: 'skills/archive-style/SKILL.md' })])
})

it('rejects ZIP packages without a manifest or with unsafe paths', async () => {
  const missing = new JSZip()
  missing.file('skills/style/SKILL.md', 'text')
  await expect(decodeContentPackageArchive(await missing.generateAsync({ type: 'uint8array' }))).rejects.toThrow('manifest.json')

  const unsafe = new JSZip()
  unsafe.file('manifest.json', JSON.stringify(manifest))
  unsafe.file('../skills/archive-style/SKILL.md', '---\nid: archive-style\nname: 归档 Skill\nstages: [write]\n---\ntext')
  await expect(decodeContentPackageArchive(await unsafe.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/路径|文件/)
})
