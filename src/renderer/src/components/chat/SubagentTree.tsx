export interface SubagentTreeItem { id: string; label: string; status: string; children?: SubagentTreeItem[] }

export function SubagentTree({ items }: { items: SubagentTreeItem[] }): React.ReactElement {
  return <ul className="space-y-1 text-xs text-muted">{items.map((item) => <li key={item.id}><span>{item.label}</span><span className="ml-2 text-faint">{item.status}</span>{item.children && <div className="ml-4 mt-1"><SubagentTree items={item.children} /></div>}</li>)}</ul>
}
