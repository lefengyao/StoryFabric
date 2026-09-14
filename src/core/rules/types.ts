export type RuleKind = 'constraint' | 'guidance'
export type RuleSeverity = 'must' | 'prefer'
export type RuleTarget = 'all' | string
export type RuleSource = 'builtin' | 'application' | 'workspace' | 'session' | 'run'

export interface Rule {
  id: string
  kind: RuleKind
  target: RuleTarget
  key: string
  value: unknown
  severity: RuleSeverity
  enabled: boolean
}

export interface RuleLayer { source: RuleSource; rules: Rule[] }
