import { useSyncExternalStore } from 'react'
import type { UiWorkspaceIdentity } from '../lib/workspaceUiScope'

export type ChatDraftScope = {
  workspaceKey: string
  session: { kind: 'existing'; id: string } | { kind: 'new' }
}

export type TextDraft = { text: string; revision: number; updatedAt: number }
export type DraftSendTransaction = {
  token: string
  scope: ChatDraftScope
  text: string
  revision: number
}

const STORAGE_KEY = 'storyfabric.ui.chat-draft.v1'
let tokenCounter = 0

function scopeKey(scope: ChatDraftScope): string {
  return JSON.stringify([scope.workspaceKey, scope.session.kind, scope.session.kind === 'existing' ? scope.session.id : ''])
}

function defaultStorage(): Storage | null {
  try { return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage } catch { return null }
}

export class ChatDraftStore {
  private readonly records = new Map<string, TextDraft>()
  private readonly revisions = new Map<string, number>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly listeners = new Map<string, Set<() => void>>()
  lastError: string | null = null

  constructor(private readonly storage: Storage | null = defaultStorage()) {
    this.readStorage()
  }

  getText(scope: ChatDraftScope): string {
    return this.records.get(scopeKey(scope))?.text ?? ''
  }

  getDraft(scope: ChatDraftScope): TextDraft | null {
    return this.records.get(scopeKey(scope)) ?? null
  }

  subscribe(scope: ChatDraftScope, listener: () => void): () => void {
    const key = scopeKey(scope)
    const set = this.listeners.get(key) ?? new Set<() => void>()
    set.add(listener)
    this.listeners.set(key, set)
    return () => { set.delete(listener); if (set.size === 0) this.listeners.delete(key) }
  }

  setText(scope: ChatDraftScope, text: string): TextDraft {
    const key = scopeKey(scope)
    const revision = (this.revisions.get(key) ?? this.records.get(key)?.revision ?? 0) + 1
    const record = { text, revision, updatedAt: Date.now() }
    this.revisions.set(key, revision)
    if (text) this.records.set(key, record)
    else this.records.delete(key)
    this.schedulePersist(key)
    this.notify(key)
    return record
  }

  beginSend(scope: ChatDraftScope, text: string): DraftSendTransaction {
    const current = this.getDraft(scope)
    const record = current?.text === text ? current : this.setText(scope, text)
    this.setText(scope, '')
    return { token: `draft-send-${Date.now()}-${++tokenCounter}`, scope, text, revision: record.revision }
  }

  clearAfterAccepted(transaction: DraftSendTransaction): boolean {
    const current = this.getDraft(transaction.scope)
    if (current) return false
    const key = scopeKey(transaction.scope)
    if ((this.revisions.get(key) ?? 0) !== transaction.revision + 1) return false
    this.persistKey(key)
    return true
  }

  restoreAfterFailure(transaction: DraftSendTransaction): boolean {
    const current = this.getDraft(transaction.scope)
    if (current) return false
    const key = scopeKey(transaction.scope)
    if ((this.revisions.get(key) ?? 0) !== transaction.revision + 1) return false
    this.setText(transaction.scope, transaction.text)
    return true
  }

  flush(): void {
    for (const key of this.timers.keys()) this.persistKey(key)
  }

  dispose(): void {
    this.flush()
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.listeners.clear()
  }

  private readStorage(): void {
    if (!this.storage) return
    try {
      const raw = this.storage.getItem(STORAGE_KEY)
      if (!raw) return
      const values = JSON.parse(raw) as Record<string, unknown>
      for (const [key, value] of Object.entries(values)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue
        const item = value as Partial<TextDraft>
        if (typeof item.text === 'string' && item.text && typeof item.revision === 'number' && Number.isFinite(item.revision)) {
          const record = { text: item.text, revision: item.revision, updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : 0 }
          this.records.set(key, record)
          this.revisions.set(key, record.revision)
        }
      }
    } catch (error) { this.lastError = error instanceof Error ? error.message : String(error) }
  }

  private schedulePersist(key: string): void {
    const previous = this.timers.get(key)
    if (previous) clearTimeout(previous)
    this.timers.set(key, setTimeout(() => { this.timers.delete(key); this.persistKey(key) }, 200))
  }

  private persistKey(key: string): void {
    const timer = this.timers.get(key)
    if (timer) { clearTimeout(timer); this.timers.delete(key) }
    if (!this.storage) return
    try {
      const values: Record<string, TextDraft> = {}
      const raw = this.storage.getItem(STORAGE_KEY)
      if (raw) Object.assign(values, JSON.parse(raw) as Record<string, TextDraft>)
      const record = this.records.get(key)
      if (record) values[key] = record
      else delete values[key]
      this.storage.setItem(STORAGE_KEY, JSON.stringify(values))
      this.lastError = null
    } catch (error) { this.lastError = error instanceof Error ? error.message : String(error) }
  }

  private notify(key: string): void { for (const listener of this.listeners.get(key) ?? []) listener() }
}

export const chatDraftStore = new ChatDraftStore()

export function useChatDraft(scope: ChatDraftScope): { text: string; setText: (text: string) => void } {
  const text = useSyncExternalStore(
    (listener) => chatDraftStore.subscribe(scope, listener),
    () => chatDraftStore.getText(scope),
    () => chatDraftStore.getText(scope)
  )
  return { text, setText: (value) => chatDraftStore.setText(scope, value) }
}

export function chatDraftScope(workspace: UiWorkspaceIdentity, activeId: string | null): ChatDraftScope {
  return { workspaceKey: JSON.stringify([workspace.source, workspace.path]), session: activeId ? { kind: 'existing', id: activeId } : { kind: 'new' } }
}
