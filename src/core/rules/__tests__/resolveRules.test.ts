import { expect, it } from 'vitest'
import { resolveRules } from '../resolveRules'

it('resolves rules from low to high priority and reports same-layer hard conflicts', () => {
  const result = resolveRules([
    { source: 'builtin', rules: [{ id: 'view', kind: 'constraint', target: 'write', key: 'viewpoint', value: 'first', severity: 'must', enabled: true }] },
    { source: 'workspace', rules: [{ id: 'view-1', kind: 'constraint', target: 'write', key: 'viewpoint', value: 'third', severity: 'must', enabled: true }] },
    { source: 'session', rules: [
      { id: 'style-a', kind: 'guidance', target: 'all', key: 'freeText', value: '短句', severity: 'prefer', enabled: true },
      { id: 'style-b', kind: 'guidance', target: 'all', key: 'freeText', value: '长句', severity: 'prefer', enabled: true }
    ] }
  ])
  expect(result.effective.find((rule) => rule.key === 'viewpoint')?.value).toBe('third')
  expect(result.overridden.map((item) => item.rule.id)).toContain('view')
  expect(result.conflicts).toHaveLength(0)
  expect(result.effective.find((rule) => rule.key === 'freeText')?.value).toBe('长句')
})

it('blocks contradictory must constraints in the same layer and migrates customPrompt once', () => {
  const result = resolveRules([{ source: 'application', rules: [
    { id: 'a', kind: 'constraint', target: 'all', key: 'viewpoint', value: 'first', severity: 'must', enabled: true },
    { id: 'b', kind: 'constraint', target: 'all', key: 'viewpoint', value: 'third', severity: 'must', enabled: true }
  ] }], { customPrompt: '不要总结。' })
  expect(result.conflicts).toHaveLength(1)
  expect(result.conflicts[0].rules.map((rule) => rule.id)).toEqual(['a', 'b'])
  expect(result.effective.filter((rule) => rule.key === 'freeText')).toHaveLength(1)
  expect(resolveRules(result.layers, { customPrompt: '不要总结。' }).effective.filter((rule) => rule.key === 'freeText')).toHaveLength(1)
})
