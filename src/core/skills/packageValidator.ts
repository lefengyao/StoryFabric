import { parseFrontMatter } from '../workspace/frontMatter'
import type { ContentPackage, ContentPackageFile, SkillDefinition, SkillPackageManifest } from './types'

export const PACKAGE_LIMITS = { compressedBytes: 2 * 1024 * 1024, expandedBytes: 8 * 1024 * 1024, entries: 100, skillBytes: 64 * 1024, ruleSetBytes: 128 * 1024 }
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const PATH = /^[A-Za-z0-9._/-]+$/
const EXECUTABLE = /(^|\/)(?:.*\.(?:js|mjs|cjs|ts|tsx|py|exe|dll|bat|cmd|ps1|sh|bin)|package\.json)$/i

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('内容包字段必须是对象')
  return value as Record<string, unknown>
}

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} 必须是非空字符串`)
  return value.trim()
}

function list(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${field} 必须是数组`)
  return value
}

function manifest(value: unknown): SkillPackageManifest {
  const raw = record(value)
  if (raw.schemaVersion !== 1) throw new Error('不支持的内容包 schema 版本')
  const result = {
    schemaVersion: 1 as const,
    id: nonEmpty(raw.id, 'manifest.id'),
    version: nonEmpty(raw.version, 'manifest.version'),
    name: nonEmpty(raw.name, 'manifest.name'),
    description: nonEmpty(raw.description, 'manifest.description'),
    author: nonEmpty(raw.author, 'manifest.author'),
    license: nonEmpty(raw.license, 'manifest.license'),
    minAppVersion: nonEmpty(raw.minAppVersion, 'manifest.minAppVersion'),
    platforms: list(raw.platforms, 'manifest.platforms') as SkillPackageManifest['platforms'],
    skills: list(raw.skills, 'manifest.skills').map((item) => { const entry = record(item); return { id: nonEmpty(entry.id, 'skill.id'), path: nonEmpty(entry.path, 'skill.path') } }),
    ruleSets: list(raw.ruleSets, 'manifest.ruleSets').map((item) => { const entry = record(item); return { id: nonEmpty(entry.id, 'ruleSet.id'), path: nonEmpty(entry.path, 'ruleSet.path') } })
  }
  if (!VERSION.test(result.version) || !VERSION.test(result.minAppVersion)) throw new Error('manifest 版本格式无效')
  if (!result.platforms.length || result.platforms.some((item) => !['windows', 'web', 'android'].includes(item))) throw new Error('manifest.platforms 无效')
  if (new Set(result.skills.map((item) => item.id)).size !== result.skills.length) throw new Error('Skill id 重复')
  if (new Set(result.ruleSets.map((item) => item.id)).size !== result.ruleSets.length) throw new Error('规则集 id 重复')
  return result
}

function ruleSet(value: unknown, expectedId: string): void {
  const raw = record(value)
  if (raw.schemaVersion !== 1) throw new Error('不支持的规则集 schema 版本')
  if (nonEmpty(raw.id, 'ruleSet.id') !== expectedId) throw new Error(`规则集 id 与 manifest 不一致：${expectedId}`)
  nonEmpty(raw.version, 'ruleSet.version')
  nonEmpty(raw.name, 'ruleSet.name')
  nonEmpty(raw.description, 'ruleSet.description')
  const rules = list(raw.rules, 'ruleSet.rules')
  for (const value of rules) {
    const item = record(value)
    const kind = item.kind
    const severity = item.severity
    if (!nonEmpty(item.id, 'rule.id') || (kind !== 'constraint' && kind !== 'guidance') || (severity !== 'must' && severity !== 'prefer')) throw new Error('规则字段无效')
    nonEmpty(item.target, 'rule.target')
    nonEmpty(item.key, 'rule.key')
    if (typeof item.enabled !== 'boolean') throw new Error('rule.enabled 必须是布尔值')
  }
}

function safePath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/') || normalized.includes('..') || !PATH.test(normalized) || normalized.split('/').some((part) => !part || part === '.')) throw new Error(`内容包路径越界或无效：${path}`)
  if (EXECUTABLE.test(normalized)) throw new Error(`内容包禁止执行文件：${path}`)
  return normalized
}

export function parseSkillMarkdown(text: string): SkillDefinition {
  if (new TextEncoder().encode(text).byteLength > PACKAGE_LIMITS.skillBytes) throw new Error('Skill 内容超过大小限制')
  const parsed = parseFrontMatter(text)
  const id = nonEmpty(parsed.data.id, 'Skill.id')
  const name = nonEmpty(parsed.data.name, 'Skill.name')
  const stagesValue = parsed.data.stages
  const stages = Array.isArray(stagesValue) ? stagesValue.filter((stage): stage is string => typeof stage === 'string' && Boolean(stage.trim())) : typeof stagesValue === 'string' ? [stagesValue] : []
  if (!stages.length) throw new Error('Skill.stages 不能为空')
  return { id, name, stages, inputKind: typeof parsed.data.inputKind === 'string' ? parsed.data.inputKind : undefined, outputKind: typeof parsed.data.outputKind === 'string' ? parsed.data.outputKind : undefined, body: parsed.content.trim() }
}

export function validateContentPackage(input: { manifest: unknown; files: ContentPackageFile[] }): ContentPackage {
  const validatedManifest = manifest(input.manifest)
  if (!Array.isArray(input.files) || input.files.length > PACKAGE_LIMITS.entries) throw new Error('内容包条目数量超过限制')
  const seen = new Set<string>()
  let expandedBytes = 0
  const files = input.files.map((file) => {
    if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') throw new Error('内容包文件无效')
    const path = safePath(file.path)
    if (seen.has(path)) throw new Error(`内容包路径重名：${path}`)
    seen.add(path)
    expandedBytes += new TextEncoder().encode(file.content).byteLength
    return { path, content: file.content }
  })
  if (expandedBytes > PACKAGE_LIMITS.expandedBytes) throw new Error('内容包展开大小超过限制')
  const fileMap = new Map(files.map((file) => [file.path, file]))
  const skillPaths = new Set(validatedManifest.skills.map((entry) => safePath(entry.path)))
  for (const entry of [...validatedManifest.skills, ...validatedManifest.ruleSets]) {
    const path = safePath(entry.path)
    if (!fileMap.has(path)) throw new Error(`manifest 引用的文件不存在：${path}`)
    if (skillPaths.has(path) && new TextEncoder().encode(fileMap.get(path)!.content).byteLength > PACKAGE_LIMITS.skillBytes) throw new Error('Skill 内容超过大小限制')
  }
  for (const entry of validatedManifest.skills) {
    const parsed = parseSkillMarkdown(fileMap.get(safePath(entry.path))!.content)
    if (parsed.id !== entry.id) throw new Error(`Skill id 与 manifest 不一致：${entry.id}`)
  }
  for (const entry of validatedManifest.ruleSets) {
    const size = new TextEncoder().encode(fileMap.get(safePath(entry.path))!.content).byteLength
    if (size > PACKAGE_LIMITS.ruleSetBytes) throw new Error('规则集内容超过大小限制')
    let parsed: unknown
    try { parsed = JSON.parse(fileMap.get(safePath(entry.path))!.content) } catch { throw new Error(`规则集 JSON 无效：${entry.id}`) }
    try { ruleSet(parsed, entry.id) } catch (error) { throw new Error(`规则集无效：${entry.id}：${error instanceof Error ? error.message : String(error)}`) }
  }
  return { manifest: validatedManifest, files }
}
