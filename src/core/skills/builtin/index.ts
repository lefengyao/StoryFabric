import type { ContentPackage } from '../types'

interface BuiltinSpec { id: string; name: string; description: string; body: string; rule: Record<string, unknown>; before: string; after: string }

const specs: BuiltinSpec[] = [
  { id: 'natural-prose', name: '自然叙述', description: '减少重复总结、模板转折与无意义铺陈。', body: '减少重复总结和模板转折，保留作者刻意的排比、重复与缓慢节奏。不要机械替换同义词，不改变事实。', rule: { avoid: ['重复总结', '无意义铺陈'], preserve: ['作者刻意重复'] }, before: '他感到非常疲惫，因为这件事让他感到很疲惫。', after: '这件事耗尽了他的力气。' },
  { id: 'natural-dialogue', name: '自然对白', description: '减少说明腔并保留人物差异与潜台词。', body: '保留人物当前意图、称谓和关系。优先用停顿、动作、回避和不同措辞呈现分歧，不给所有角色添加相同口头禅。', rule: { avoid: ['对白解释已知事实'], preserve: ['人物潜台词', '称谓'] }, before: '“我很生气，因为你昨天没有来。”她生气地说。', after: '“你昨天没来。”她把门推回去，“现在也不用来了。”' },
  { id: 'show-emotion', name: '情绪落地', description: '把适合的抽象情绪改为动作、感官和具体反应。', body: '将适合的抽象情绪解释落到动作、感官和具体反应；不强行扩写每个情绪，不编造关键事实。', rule: { prefer: ['动作', '感官', '具体反应'], preserve: ['关键事实'] }, before: '他很紧张。', after: '他把杯沿转了一圈，指腹在水珠上打滑。' },
  { id: 'rhythm', name: '节奏与冗余', description: '改善长短句、段落和场景节奏。', body: '核对长短句、段落和场景节奏，减少重复信息。不要为了变化破坏作者刻意重复、排比或缓慢节奏。', rule: { prefer: ['长短句变化', '段落节奏'], preserve: ['刻意重复', '排比'] }, before: '雨下得很大，雨声很大，整个夜晚都被雨声填满。', after: '雨下了一夜。屋檐的声音没有停。' },
  { id: 'author-voice', name: '作者文风保持', description: '从用户样章中提炼可执行的文风规则。', body: '只使用用户选定的样章整理文风规则；修改后核对作者偏好。不冒充或模仿特定作者，不保证检测器分数。', rule: { requiresSource: 'user-selected-sample', preserve: ['作者偏好'] }, before: '样章：他没有回答，只看向窗外。', after: '提炼：关键情绪尽量留白，不替角色解释未说出口的原因。' }
]

function makePackage(spec: BuiltinSpec): ContentPackage {
  const id = `storyfabric.${spec.id}`
  return {
    manifest: { schemaVersion: 1, id, version: '1.0.0', name: spec.name, description: spec.description, author: 'StoryFabric', license: 'StoryFabric-Bundled', minAppVersion: '0.1.5', platforms: ['windows', 'web', 'android'], skills: [{ id: spec.id, path: `skills/${spec.id}/SKILL.md` }], ruleSets: [{ id: spec.id, path: `rules/${spec.id}.json` }] },
    files: [
      { path: `skills/${spec.id}/SKILL.md`, content: `---\nid: ${spec.id}\nname: ${spec.name}\nstages: [anti-ai, write, polish]\ninputKind: prose-or-brief\noutputKind: guidance-or-prose\n---\n${spec.body}` },
      { path: `rules/${spec.id}.json`, content: JSON.stringify({ schemaVersion: 1, id: spec.id, version: '1.0.0', name: spec.name, description: spec.description, rules: Object.entries(spec.rule).map(([key, value]) => ({ id: `${spec.id}-${key}`, kind: 'guidance', target: 'all', key, value, severity: 'prefer', enabled: true })) }, null, 2) },
      { path: `examples/${spec.id}-before.md`, content: spec.before },
      { path: `examples/${spec.id}-after.md`, content: spec.after }
    ]
  }
}

export const builtinPackages: ContentPackage[] = specs.map(makePackage)
