import { useEffect, useState } from 'react'
import type { CreativePackageSummary } from '../../../../shared/creative'
import { api } from '../../lib/api'

export interface CreativeSelection { selectedSkillIds: string[]; selectedRuleSetIds: string[] }

export function CreativeOptions({ value, onChange }: { value: CreativeSelection; onChange: (value: CreativeSelection) => void }): React.ReactElement {
  const [packages, setPackages] = useState<CreativePackageSummary[]>([])
  useEffect(() => { void api.listCreativePackages().then(setPackages).catch(() => undefined) }, [])
  const toggle = (field: keyof CreativeSelection, id: string, checked: boolean): void => {
    const current = value[field]
    onChange({ ...value, [field]: checked ? [...current, id] : current.filter((item) => item !== id) })
  }
  return <details className="rounded-lg border border-line bg-panel px-3 py-2">
    <summary className="cursor-pointer text-xs font-medium text-muted">本次创作 Skill / 规则（可选）</summary>
    <div className="mt-2 grid gap-1 sm:grid-cols-2">
      {packages.filter((item) => item.enabled).flatMap((item) => [
        ...item.skills.map((id) => <label key={`skill:${id}`} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={value.selectedSkillIds.includes(id)} onChange={(event) => toggle('selectedSkillIds', id, event.target.checked)} />{item.name} · Skill</label>),
        ...item.ruleSets.map((id) => <label key={`rule:${id}`} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={value.selectedRuleSetIds.includes(id)} onChange={(event) => toggle('selectedRuleSetIds', id, event.target.checked)} />{item.name} · 规则</label>)
      ])}
    </div>
  </details>
}
