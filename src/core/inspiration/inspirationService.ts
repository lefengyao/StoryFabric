import type { InspirationArtifactInput } from '../../shared/inspiration'
import type { FileStore } from '../storage/fileStore'
import { normalizeProjectDocPath, validateProjectDocContent } from '../workspace/projectDocs'
import { RuleStore } from '../rules/ruleStore'
import type { RuleLayer } from '../rules/types'
import { ContentPackageStore } from '../skills/packageStore'
import type { ContentPackage } from '../skills/types'

function safeId(value: string): string {
  const id = value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
  return id || `inspiration-${Date.now().toString(36)}`
}

function nameOf(value: string): string {
  const name = value.trim().replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').slice(0, 80)
  return name || '灵感资料'
}

export async function saveInspirationArtifact(store: FileStore, input: InspirationArtifactInput): Promise<void> {
  const name = nameOf(input.name)
  const content = input.content.trim()
  if (!content) throw new Error('灵感结果不能为空')
  if (input.target === 'docs') {
    const path = normalizeProjectDocPath(`${name.replace(/\s+/g, '-')}.md`)
    validateProjectDocContent(content)
    await store.writeText(`docs/${path}`, content)
    return
  }
  if (input.target === 'rules') {
    const rules = await new RuleStore(store).load()
    const existingWorkspace = rules.find((item) => item.source === 'workspace')
    const layer: RuleLayer = {
      source: 'workspace',
      rules: [...(existingWorkspace?.rules ?? []).filter((rule) => rule.id !== `inspiration-${safeId(name)}`), { id: `inspiration-${safeId(name)}`, kind: 'guidance', target: 'all', key: `灵感台：${name}`, value: content, severity: 'prefer', enabled: true }]
    }
    await new RuleStore(store).save([...rules.filter((item) => item.source !== 'workspace'), layer])
    return
  }
  const id = safeId(name)
  const packageInput: ContentPackage = {
    manifest: {
      schemaVersion: 1,
      id: `inspiration-${id}`,
      version: '1.0.0',
      name: `灵感台：${name}`,
      description: '由灵感台蒸馏结果生成的 Skill',
      author: 'StoryFabric',
      license: 'UNLICENSED',
      minAppVersion: '0.2.1',
      platforms: ['windows', 'web', 'android'],
      skills: [{ id: `inspiration-${id}`, path: 'skills/inspiration.md' }],
      ruleSets: []
    },
    files: [{
      path: 'skills/inspiration.md',
      content: `---\nid: inspiration-${id}\nname: 灵感台蒸馏：${name}\nstages:\n  - plan\n  - prompt\ninputKind: reference\noutputKind: guidance\n---\n\n${content}`
    }]
  }
  await new ContentPackageStore(store).save(packageInput, true)
}
