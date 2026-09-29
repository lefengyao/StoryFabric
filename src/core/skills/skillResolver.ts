import type { AppliedSkillRef, SkillApplicationEvent } from '../../shared/agentEvidence'
import type { GlobalSkillLibrary, GlobalSkillPackage } from './globalSkillLibrary'
import { parseSkillMarkdown } from './packageValidator'

export interface SkillSnapshot {
  libraryId: string
  packages: GlobalSkillPackage[]
  createdAt: number
}

export interface ResolvedSkill {
  ref: AppliedSkillRef
  name: string
  stages: string[]
  body: string
  reason: string
}

export interface SkillResolution {
  skills: ResolvedSkill[]
  prompt: string
  events: SkillApplicationEvent[]
}

interface ResolveInput {
  runId: string
  stageId?: string
  agentId: string
  query?: string
  selectedSkillIds?: string[]
  requestId?: string
  snapshot: SkillSnapshot
  emit?: (event: SkillApplicationEvent) => void
}

function tokens(value: string): string[] {
  return value.toLocaleLowerCase().split(/[\s,，。！？；：、/\\()[\]{}"'“”‘’_-]+/u).map((item) => item.trim()).filter((item) => item.length >= 2)
}

function refOf(pkg: GlobalSkillPackage, skillId: string, reason: string): AppliedSkillRef {
  return { libraryId: 'global', packageId: pkg.manifest.id, skillId, version: pkg.manifest.version, contentHash: pkg.contentHash, reason }
}

function eventOf(input: ResolveInput, status: SkillApplicationEvent['status'], skills: AppliedSkillRef[]): SkillApplicationEvent {
  return { runId: input.runId, ...(input.stageId ? { stageId: input.stageId } : {}), agentId: input.agentId, status, skills, ...(input.requestId ? { requestId: input.requestId } : {}) }
}

export class SkillResolver {
  constructor(private readonly library: GlobalSkillLibrary) {}

  async createSnapshot(): Promise<SkillSnapshot> {
    return { libraryId: 'global', packages: structuredClone(await this.library.list({ enabledOnly: true })), createdAt: Date.now() }
  }

  async listSkills(snapshot: SkillSnapshot): Promise<Array<{ packageId: string; packageVersion: string; packageName: string; contentHash: string; id: string; name: string; stages: string[]; description: string }>> {
    const result: Array<{ packageId: string; packageVersion: string; packageName: string; contentHash: string; id: string; name: string; stages: string[]; description: string }> = []
    for (const pkg of snapshot.packages) {
      for (const entry of pkg.manifest.skills) {
        const file = pkg.files.find((item) => item.path === entry.path)
        if (!file) continue
        try {
          const skill = parseSkillMarkdown(file.content)
          result.push({ packageId: pkg.manifest.id, packageVersion: pkg.manifest.version, packageName: pkg.manifest.name, contentHash: pkg.contentHash, id: skill.id, name: skill.name, stages: skill.stages, description: pkg.manifest.description })
        } catch {
          // Broken packages are rejected at install time; a stale/corrupt package is simply not discoverable.
        }
      }
    }
    return result
  }

  async resolve(input: ResolveInput): Promise<SkillResolution> {
    const events: SkillApplicationEvent[] = []
    const publish = (event: SkillApplicationEvent) => { events.push(event); input.emit?.(event) }
    publish(eventOf(input, 'checked', []))
    const selected = new Set(input.selectedSkillIds ?? [])
    const queryTokens = new Set(tokens(input.query ?? ''))
    const matched: ResolvedSkill[] = []
    for (const pkg of input.snapshot.packages) {
      for (const entry of pkg.manifest.skills) {
        const file = pkg.files.find((item) => item.path === entry.path)
        if (!file) continue
        let skill
        try { skill = parseSkillMarkdown(file.content) } catch { continue }
        const explicitlySelected = selected.has(skill.id) || selected.has(pkg.manifest.id) || selected.has(`${pkg.manifest.id}:${skill.id}`)
        if (input.stageId && !skill.stages.includes(input.stageId) && !explicitlySelected) continue
        const searchable = tokens(`${skill.name} ${pkg.manifest.name} ${pkg.manifest.description} ${skill.body}`)
        const keywordMatched = queryTokens.size > 0 && searchable.some((token) => queryTokens.has(token))
        const stageMatched = Boolean(input.stageId && skill.stages.includes(input.stageId) && !(input.selectedSkillIds?.length))
        const automaticallyMatched = keywordMatched || stageMatched
        if (!explicitlySelected && !automaticallyMatched) continue
        const reason = explicitlySelected ? '用户显式选择' : keywordMatched ? '与用户请求关键词匹配' : '当前阶段适用'
        matched.push({ ref: refOf(pkg, skill.id, reason), name: skill.name, stages: skill.stages, body: skill.body, reason })
      }
    }
    const refs = matched.map((item) => item.ref)
    if (!matched.length) {
      publish(eventOf(input, 'none', []))
      return { skills: [], prompt: '', events }
    }
    publish(eventOf(input, 'matched', refs))
    publish(eventOf(input, 'loaded', refs))
    publish(eventOf(input, 'applied', refs))
    return {
      skills: matched,
      prompt: matched.map((item) => `### ${item.name}（${item.ref.packageId}@${item.ref.version}，${item.reason}）\n${item.body}`).join('\n\n'),
      events
    }
  }
}
