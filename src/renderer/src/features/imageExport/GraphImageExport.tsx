import { useMemo, useRef, useState } from 'react'
import { cloneValue } from '../../../../shared/runtimeCompatibility'
import { ImageDown } from 'lucide-react'
import type { CharacterDoc, Relationship, StoryEvent, VolumeMeta } from '../../../../shared/types'
import { Button, Input } from '../../components/ui/primitives'
import { Modal } from '../../components/ui/modal'
import { captureView } from './capture'
import { ImageExportDialog } from './ImageExportDialog'
import { EventGraphImage, RelationshipGraphImage } from './GraphImages'
import { selectEventGraph, selectRelationshipGraph } from './selection'

function toggle(ids: ReadonlySet<string>, id: string): Set<string> { const next = new Set(ids); if (next.has(id)) next.delete(id); else next.add(id); return next }
const rowClass = 'flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-sm hover:bg-elevated'

export function RelationshipImageExport({ characters, relationships, workspaceName, beforeExport }: { characters: CharacterDoc[]; relationships: Relationship[]; workspaceName: string; beforeExport?: () => Promise<boolean> }): React.ReactElement {
  const current = useRef({ characters, relationships })
  current.current = { characters, relationships }
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState(false)
  const [query, setQuery] = useState('')
  const [people, setPeople] = useState<ReadonlySet<string>>(new Set())
  const [relations, setRelations] = useState<ReadonlySet<string>>(new Set())
  const [frozen, setFrozen] = useState<ReturnType<typeof selectRelationshipGraph> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const available = relationships.filter((relationship) => people.has(relationship.fromId) && people.has(relationship.toId))
  const visible = characters.filter((character) => `${character.name} ${character.aliases.join(' ')} ${character.faction}`.toLowerCase().includes(query.trim().toLowerCase()))
  const name = (id: string) => characters.find((character) => character.id === id)?.name ?? '未命名人物'
  const begin = async () => {
    try {
      if (beforeExport && !await beforeExport()) return
      setPeople(new Set(current.current.characters.map((character) => character.id))); setRelations(new Set(current.current.relationships.map((relationship) => relationship.id))); setQuery(''); setOpen(true); setError(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  return <>
    <Button size="sm" variant="ghost" disabled={!characters.length} onClick={() => void begin()}><ImageDown size={13} /> 导出图片</Button>
    {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    <Modal open={open} onOpenChange={setOpen} title="选择人物和关系" description="只导出勾选人物及两端均已勾选的关系；独立人物仍保留。" wide>
      <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索人物、别名或阵营" aria-label="搜索导出人物" />
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div><div className="mb-2 flex flex-wrap items-center gap-2 text-xs"><span className="mr-auto font-medium">人物 {people.size}</span><Button size="sm" onClick={() => setPeople(new Set([...people, ...visible.map((character) => character.id)]))}>全选搜索结果</Button><Button size="sm" variant="ghost" onClick={() => setPeople(new Set())}>清空</Button></div>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-line p-1">{visible.map((character) => <label key={character.id} className={rowClass}><input type="checkbox" className="mt-1 accent-[var(--accent)]" checked={people.has(character.id)} onChange={() => setPeople(toggle(people, character.id))} /><span className="min-w-0 break-words">{character.name}<span className="ml-2 text-xs text-faint">{character.faction}</span></span></label>)}</div>
        </div>
        <div><div className="mb-2 flex flex-wrap items-center gap-2 text-xs"><span className="mr-auto font-medium">可选关系 {available.length}</span><Button size="sm" onClick={() => setRelations(new Set(available.map((relationship) => relationship.id)))}>全选</Button><Button size="sm" variant="ghost" onClick={() => setRelations(new Set())}>清空</Button></div>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-line p-1">{available.map((relationship) => <label key={relationship.id} className={rowClass}><input type="checkbox" className="mt-1 accent-[var(--accent)]" checked={relations.has(relationship.id)} onChange={() => setRelations(toggle(relations, relationship.id))} /><span className="min-w-0 break-words">{name(relationship.fromId)} {relationship.directed ? '→' : '—'} {name(relationship.toId)}<span className="block text-xs text-muted">{[relationship.type, relationship.label].filter(Boolean).join(' · ')}</span></span></label>)}{!available.length && <p className="p-3 text-xs text-faint">所选人物之间没有关系，可导出独立节点。</p>}</div>
        </div>
      </div>
      <div className="mt-4 flex justify-end"><Button variant="primary" disabled={!people.size} onClick={() => { setFrozen(cloneValue(selectRelationshipGraph(characters, relationships, people, relations))); setOpen(false); setPreview(true) }}>预览所选图谱</Button></div>
    </Modal>
    {frozen && <ImageExportDialog open={preview} onOpenChange={setPreview} workspaceName={workspaceName} title="人物关系图" generate={(split) => captureView(<RelationshipGraphImage graph={frozen} workspaceName={workspaceName} />, { split })} />}
  </>
}

export function EventImageExport({ events, volumes, workspaceName, beforeExport }: { events: StoryEvent[]; volumes: VolumeMeta[]; workspaceName: string; beforeExport?: () => Promise<boolean> }): React.ReactElement {
  const current = useRef({ events, volumes })
  current.current = { events, volumes }
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState(false)
  const [query, setQuery] = useState('')
  const [volumeIds, setVolumeIds] = useState<ReadonlySet<string>>(new Set())
  const [eventIds, setEventIds] = useState<ReadonlySet<string>>(new Set())
  const [frozen, setFrozen] = useState<{ graph: ReturnType<typeof selectEventGraph>; volumes: VolumeMeta[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const groups = useMemo(() => {
    const all = [...volumes].sort((a, b) => a.order - b.order)
    for (const event of events) { const id = event.volumeId ?? 'vol_default'; if (!all.some((volume) => volume.id === id)) all.push({ id, title: '未分卷', order: Number.MAX_SAFE_INTEGER }) }
    return all
  }, [events, volumes])
  const sorted = [...events].sort((a, b) => Number(Boolean(a.branchFromId)) - Number(Boolean(b.branchFromId)) || a.order - b.order)
  const visible = sorted.filter((event) => volumeIds.has(event.volumeId ?? 'vol_default') && `${event.title} ${event.storyTime}`.toLowerCase().includes(query.toLowerCase()))
  const selectedCount = events.filter((event) => volumeIds.has(event.volumeId ?? 'vol_default') && eventIds.has(event.id)).length
  const begin = async () => {
    try {
      if (beforeExport && !await beforeExport()) return
      setVolumeIds(new Set([...current.current.volumes.map((volume) => volume.id), ...current.current.events.map((event) => event.volumeId ?? 'vol_default')])); setEventIds(new Set(current.current.events.map((event) => event.id))); setQuery(''); setError(null); setOpen(true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  return <>
    <Button size="sm" variant="ghost" disabled={!events.length} onClick={() => void begin()}><ImageDown size={13} /> 导出图片</Button>
    {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    <Modal open={open} onOpenChange={setOpen} title="选择卷与事件节点" description="先选择卷，再勾选具体节点；跳过中间节点不会生成新的因果连接。" wide>
      <div className="mb-2 flex flex-wrap gap-2"><Button size="sm" onClick={() => { setVolumeIds(new Set(groups.map((volume) => volume.id))); setEventIds(new Set(events.map((event) => event.id))) }}>全选所有卷和节点</Button><Button size="sm" variant="ghost" onClick={() => { setVolumeIds(new Set()); setEventIds(new Set()) }}>清空</Button></div>
      <div className="max-h-36 overflow-y-auto rounded-lg border border-line p-1">{groups.map((volume) => <div key={volume.id} className="flex items-center gap-2"><label className={`${rowClass} min-w-0 flex-1`}><input type="checkbox" className="mt-1 accent-[var(--accent)]" checked={volumeIds.has(volume.id)} onChange={() => { setVolumeIds(toggle(volumeIds, volume.id)); if (!volumeIds.has(volume.id)) setEventIds(new Set([...eventIds, ...events.filter((event) => (event.volumeId ?? 'vol_default') === volume.id).map((event) => event.id)])) }} /><span className="break-words">{volume.title}</span></label><Button size="sm" variant="ghost" onClick={() => { setVolumeIds(new Set([...volumeIds, volume.id])); setEventIds(new Set([...eventIds, ...events.filter((event) => (event.volumeId ?? 'vol_default') === volume.id).map((event) => event.id)])) }}>该卷全选</Button></div>)}</div>
      <Input className="mt-3" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索事件或故事时间" aria-label="搜索导出事件" />
      <div className="my-2 flex flex-wrap items-center gap-2 text-xs"><span className="mr-auto font-medium">已选 {selectedCount} 个节点</span><Button size="sm" onClick={() => setEventIds(new Set([...eventIds, ...visible.map((event) => event.id)]))}>全选候选节点</Button><Button size="sm" variant="ghost" onClick={() => setEventIds(new Set())}>清空节点</Button></div>
      <div className="max-h-64 overflow-y-auto rounded-lg border border-line p-1">{visible.map((event) => <label key={event.id} className={rowClass}><input type="checkbox" className="mt-1 accent-[var(--accent)]" checked={eventIds.has(event.id)} onChange={() => setEventIds(toggle(eventIds, event.id))} /><span className="min-w-0 break-words">{event.title}<span className="block text-xs text-muted">{event.branchFromId ? '分支' : '主线'} · {groups.find((volume) => volume.id === (event.volumeId ?? 'vol_default'))?.title} {event.storyTime}</span></span></label>)}</div>
      <div className="mt-4 flex justify-end"><Button variant="primary" disabled={!selectedCount} onClick={() => { setFrozen(cloneValue({ graph: selectEventGraph(events, volumeIds, eventIds), volumes: groups })); setOpen(false); setPreview(true) }}>预览所选事件图</Button></div>
    </Modal>
    {frozen && <ImageExportDialog open={preview} onOpenChange={setPreview} workspaceName={workspaceName} title="事件脉络图" generate={(split) => captureView(<EventGraphImage graph={frozen.graph} volumes={frozen.volumes} workspaceName={workspaceName} />, { split })} />}
  </>
}
