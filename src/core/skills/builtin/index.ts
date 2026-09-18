import type { ContentPackage } from '../types'

interface BuiltinSpec { id: string; name: string; description: string; body: string; rule: Record<string, unknown>; before: string; after: string; stages?: string[] }

const specs: BuiltinSpec[] = [
  { id: 'natural-prose', name: '自然叙述', description: '减少重复总结、模板转折与无意义铺陈。', body: '减少重复总结和模板转折，保留作者刻意的排比、重复与缓慢节奏。不要机械替换同义词，不改变事实。', rule: { avoid: ['重复总结', '无意义铺陈'], preserve: ['作者刻意重复'] }, before: '他感到非常疲惫，因为这件事让他感到很疲惫。', after: '这件事耗尽了他的力气。' },
  { id: 'natural-dialogue', name: '自然对白', description: '减少说明腔并保留人物差异与潜台词。', body: '保留人物当前意图、称谓和关系。优先用停顿、动作、回避和不同措辞呈现分歧，不给所有角色添加相同口头禅。', rule: { avoid: ['对白解释已知事实'], preserve: ['人物潜台词', '称谓'] }, before: '“我很生气，因为你昨天没有来。”她生气地说。', after: '“你昨天没来。”她把门推回去，“现在也不用来了。”' },
  { id: 'show-emotion', name: '情绪落地', description: '把适合的抽象情绪改为动作、感官和具体反应。', body: '将适合的抽象情绪解释落到动作、感官和具体反应；不强行扩写每个情绪，不编造关键事实。', rule: { prefer: ['动作', '感官', '具体反应'], preserve: ['关键事实'] }, before: '他很紧张。', after: '他把杯沿转了一圈，指腹在水珠上打滑。' },
  { id: 'rhythm', name: '节奏与冗余', description: '改善长短句、段落和场景节奏。', body: '核对长短句、段落和场景节奏，减少重复信息。不要为了变化破坏作者刻意重复、排比或缓慢节奏。', rule: { prefer: ['长短句变化', '段落节奏'], preserve: ['刻意重复', '排比'] }, before: '雨下得很大，雨声很大，整个夜晚都被雨声填满。', after: '雨下了一夜。屋檐的声音没有停。' },
  { id: 'author-voice', name: '作者文风保持', description: '从用户样章中提炼可执行的文风规则。', body: '只使用用户选定的样章整理文风规则；修改后核对作者偏好。不冒充或模仿特定作者，不保证检测器分数。', rule: { requiresSource: 'user-selected-sample', preserve: ['作者偏好'] }, before: '样章：他没有回答，只看向窗外。', after: '提炼：关键情绪尽量留白，不替角色解释未说出口的原因。' },
  {
    id: 'planning-first',
    name: '先规划后写作',
    description: '强制先读取证据、形成大纲与设定，再允许正文执行。',
    body: '执行写作目标时，必须先读取项目证据并产出可核对的 brief、大纲、人物/设定约束和场景计划；先让用户或运行时门禁确认规划完整，再进入正文写作。不要为了尽快产出正文而跳过规划、设定和冲突检查。',
    rule: { order: ['evidence', 'brief', 'outline', 'setting', 'write'], requiresGate: true, preserve: ['事实依据', '用户限制'] },
    before: '直接写正文。',
    after: '先交付证据清单、故事 brief、大纲和设定，再进入正文。',
    stages: ['plan', 'setting', 'prompt', 'write', 'polish', 'review']
  },
  {
    id: 'require-clarification',
    name: '必要时澄清',
    description: '仅在关键信息缺失或方向不唯一时向用户提问。',
    body: '只有当缺少的输入会改变任务方向、审批范围或关键事实时才调用 ask_user；如果用户目标清晰，直接执行并记录合理假设。提问必须具体、结构化，并说明答案会影响什么，不要用泛化问题打断连续工作。',
    rule: { askOnlyWhen: ['关键输入缺失', '方向不唯一', '审批范围不明确'], avoid: ['清晰请求中的泛化提问'] },
    before: '请告诉我你想要什么。',
    after: '已有目标清晰时直接执行；只有缺少会改变结果的关键信息时才提出结构化问题。',
    stages: ['plan', 'setting', 'prompt', 'anti-ai', 'write', 'polish', 'review']
  }
]

function makePackage(spec: BuiltinSpec): ContentPackage {
  const id = `storyfabric.${spec.id}`
  return {
    manifest: { schemaVersion: 1, id, version: '1.0.0', name: spec.name, description: spec.description, author: 'StoryFabric', license: 'StoryFabric-Bundled', minAppVersion: '0.1.5', platforms: ['windows', 'web', 'android'], skills: [{ id: spec.id, path: `skills/${spec.id}/SKILL.md` }], ruleSets: [{ id: spec.id, path: `rules/${spec.id}.json` }] },
    files: [
      { path: `skills/${spec.id}/SKILL.md`, content: `---\nid: ${spec.id}\nname: ${spec.name}\nstages: [${(spec.stages ?? ['anti-ai', 'write', 'polish']).join(', ')}]\ninputKind: prose-or-brief\noutputKind: guidance-or-prose\n---\n${spec.body}` },
      { path: `rules/${spec.id}.json`, content: JSON.stringify({ schemaVersion: 1, id: spec.id, version: '1.0.0', name: spec.name, description: spec.description, rules: Object.entries(spec.rule).map(([key, value]) => ({ id: `${spec.id}-${key}`, kind: 'guidance', target: 'all', key, value, severity: 'prefer', enabled: true })) }, null, 2) },
      { path: `examples/${spec.id}-before.md`, content: spec.before },
      { path: `examples/${spec.id}-after.md`, content: spec.after }
    ]
  }
}

export const builtinPackages: ContentPackage[] = specs.map(makePackage)
