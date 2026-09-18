import type { ToolDefJson } from '../../shared/types'
import type { GlobalSkillLibrary } from './globalSkillLibrary'
import { validateContentPackage } from './packageValidator'
import { SkillResolver, type SkillSnapshot } from './skillResolver'
import type { ContentPackage } from './types'

export const SKILL_TOOL_DEFS: ToolDefJson[] = [
  { name: 'list_skills', description: '列出当前运行固定快照中的已启用全局 Skill。', parameters: { type: 'object', properties: {} } },
  { name: 'read_skill', description: '读取固定快照中的一个 Skill 正文；不会执行脚本或访问任意路径。', parameters: { type: 'object', additionalProperties: false, properties: { skillId: { type: 'string' }, packageId: { type: 'string' } }, required: ['skillId'] } },
  { name: 'propose_skill_package', description: '提出一个待确认的 Skill 包候选；只验证和返回候选，不会自动安装。', parameters: { type: 'object', additionalProperties: false, properties: { package: { type: 'object' }, reason: { type: 'string', minLength: 1 } }, required: ['package', 'reason'] } }
]

export interface SkillToolResult { ok: boolean; text: string; preview: string; candidatePackage?: ContentPackage; candidateReason?: string }

function preview(text: string): string { return text.length > 160 ? `${text.slice(0, 160)}…` : text }

export async function executeSkillTool(library: GlobalSkillLibrary, name: string, argsJson: string, snapshot: SkillSnapshot): Promise<SkillToolResult> {
  let args: Record<string, unknown>
  try {
    const parsed = JSON.parse(argsJson || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('参数必须是对象')
    args = parsed as Record<string, unknown>
  } catch (error) {
    const text = `Skill 工具参数无效：${error instanceof Error ? error.message : String(error)}`
    return { ok: false, text, preview: text }
  }
  if (name === 'list_skills') {
    const result = await new SkillResolver(library).listSkills(snapshot)
    const text = JSON.stringify(result)
    return { ok: true, text, preview: preview(text) }
  }
  if (name === 'read_skill') {
    const skillId = typeof args.skillId === 'string' ? args.skillId : ''
    const packageId = typeof args.packageId === 'string' ? args.packageId : undefined
    for (const pkg of snapshot.packages) {
      if (packageId && pkg.manifest.id !== packageId) continue
      const entry = pkg.manifest.skills.find((item) => item.id === skillId)
      if (!entry) continue
      const file = pkg.files.find((item) => item.path === entry.path)
      if (file) return { ok: true, text: file.content, preview: preview(file.content) }
    }
    const text = `未找到 Skill：${skillId}`
    return { ok: false, text, preview: text }
  }
  if (name === 'propose_skill_package') {
    try {
      const pkg = validateContentPackage(args.package as { manifest: unknown; files: Array<{ path: string; content: string }> })
      const reason = typeof args.reason === 'string' && args.reason.trim() ? args.reason.trim() : '智能体建议该 Skill 用于当前任务'
      const text = JSON.stringify({ status: 'candidate', requiresConfirmation: true, package: pkg, reason })
      return { ok: true, text, preview: '已生成待确认 Skill 包候选；尚未安装', candidatePackage: pkg, candidateReason: reason }
    } catch (error) {
      const text = `Skill 包候选无效：${error instanceof Error ? error.message : String(error)}`
      return { ok: false, text, preview: text }
    }
  }
  return { ok: false, text: `未知 Skill 工具：${name}`, preview: `未知工具：${name}` }
}
