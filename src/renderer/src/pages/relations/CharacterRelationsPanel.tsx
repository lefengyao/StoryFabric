import React from 'react'
import { Network, Plus, Trash2, X } from 'lucide-react'
import { Badge, Button, EmptyState } from '../../components/ui/primitives'
import type { CharacterDoc, Relationship } from '../../../../shared/types'
import type { CharacterRelationshipItem } from './relationshipInspector'

interface CharacterRelationsPanelProps {
  character: CharacterDoc
  items: CharacterRelationshipItem[]
  canAdd: boolean
  busy: boolean
  error: string | null
  onAdd: () => void
  onEdit: (relationship: Relationship) => void
  onDelete: (id: string) => void
  onClose: () => void
}

export function CharacterRelationsPanel({
  character,
  items,
  canAdd,
  busy,
  error,
  onAdd,
  onEdit,
  onDelete,
  onClose
}: CharacterRelationsPanelProps): React.ReactElement {
  return (
    <>
      <div className="mb-3 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-base font-semibold">{character.name}</h2>
          <p className="mt-1 text-xs text-muted">与其他人物的关系 · {items.length} 条</p>
        </div>
        <Button size="icon" variant="ghost" disabled={busy} aria-label="关闭人物关系" onClick={onClose}>
          <X size={15} />
        </Button>
      </div>
      <Button
        className="mb-3 w-full justify-center"
        size="sm"
        variant="primary"
        disabled={!canAdd || busy}
        aria-label={`为${character.name}添加关系`}
        onClick={onAdd}
      >
        <Plus size={13} /> 为此人物添加关系
      </Button>
      <ul className="space-y-2">
        {items.map(({ relationship, otherCharacter, direction }) => {
          const fromName = direction === 'incoming' ? otherCharacter.name : character.name
          const toName = direction === 'incoming' ? character.name : otherCharacter.name
          const directionLabel = direction === 'mutual' ? `${fromName}与${toName}的双向关系` : `${fromName}指向${toName}`
          return (
            <li key={relationship.id} className="rounded-lg border border-line bg-panel p-3">
              <div className="break-words text-sm font-medium" aria-label={directionLabel}>
                {fromName}
                <span className="mx-1.5 text-faint" aria-hidden="true">{direction === 'mutual' ? '⇄' : '→'}</span>
                {toName}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge tone="accent" className="!h-auto max-w-full !whitespace-normal break-words">{relationship.type || '未分类'}</Badge>
                {relationship.label && <Badge className="!h-auto max-w-full !whitespace-normal break-words">{relationship.label}</Badge>}
              </div>
              {relationship.description && <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-muted">{relationship.description}</p>}
              <div className="mt-2 flex justify-end gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  aria-label={`编辑与${otherCharacter.name}的关系`}
                  onClick={() => onEdit(relationship)}
                >
                  编辑
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger hover:text-danger"
                  disabled={busy}
                  aria-label={`删除与${otherCharacter.name}的关系`}
                  onClick={() => onDelete(relationship.id)}
                >
                  <Trash2 size={13} /> 删除
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
      {!items.length && (
        <EmptyState
          icon={<Network size={26} />}
          title="这个人物还没有关系"
          hint={canAdd ? '可以通过上方按钮添加关系。' : '至少需要两位人物，创建其他人物后可使用上方按钮添加关系。'}
        />
      )}
      {error && <p role="alert" className="mt-3 break-words text-xs text-danger">{error}</p>}
    </>
  )
}
