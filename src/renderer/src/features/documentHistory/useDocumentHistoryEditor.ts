import { useEffect, useRef, useState } from 'react'
import type { DocumentKind, DocumentSnapshot } from '../../../../shared/documentHistory'
import type { ChapterDoc, OutlineDoc } from '../../../../shared/types'
import { api } from '../../lib/api'
import { DocumentEditSession, type CaptureSource, type EditSessionState } from './editSession'
import { registerDocumentLeaveGuard } from './navigationGuard'

type EditorDocument = Partial<ChapterDoc> | OutlineDoc
const EMPTY_STATE: EditSessionState = { saving: false, pendingHistory: false, error: null, lastHistoryAt: null }

export function documentFingerprint(document: EditorDocument): string {
  const record = document as unknown as Record<string, unknown>
  return JSON.stringify(Object.fromEntries(Object.keys(record).filter((key) => !['writeRevision', 'updatedAt', 'wordCount'].includes(key)).sort().map((key) => [key, record[key]])))
}

export function useDocumentHistoryEditor<T extends EditorDocument>({ kind, workspaceKey, onDocument, onSaved }: {
  kind: DocumentKind
  workspaceKey: string
  onDocument: (document: T, dirty: boolean) => void
  onSaved?: (document: T) => void | Promise<void>
}) {
  const [state, setState] = useState(EMPTY_STATE)
  const sessionRef = useRef<DocumentEditSession<T> | null>(null)
  const keyRef = useRef(workspaceKey)
  const callbackRef = useRef({ onDocument, onSaved })
  const editGenerationRef = useRef(0)
  const rebaseRef = useRef<(() => Promise<void>) | null>(null)
  keyRef.current = workspaceKey
  callbackRef.current = { onDocument, onSaved }

  const begin = (snapshot: DocumentSnapshot): void => {
    editGenerationRef.current++
    sessionRef.current?.dispose()
    const scope = workspaceKey
    const entityId = snapshot.document.id
    let baseline = snapshot
    let current = snapshot.document as unknown as T
    let session: DocumentEditSession<T>
    session = new DocumentEditSession<T>({
      initial: current,
      fingerprint: documentFingerprint,
      onState: (next) => {
        if (keyRef.current === scope && sessionRef.current === session) {
          setState(next)
        }
      },
      persist: async (document, source) => {
        if (keyRef.current !== scope || sessionRef.current !== session || document.id !== entityId) throw new Error('编辑会话已切换，请在当前文档重试。')
        const unchanged = documentFingerprint(document) === documentFingerprint(baseline.document)
        let saved: T
        if (source && unchanged) {
          const fresh = await api.getDocumentSnapshot(kind, entityId)
          if (fresh.writeRevision !== baseline.writeRevision || fresh.sourceText !== baseline.sourceText) throw new Error('SOURCE_CHANGED：当前文件已变化，请比较当前文件后重试。')
          const historyOptions = { source, baseRevision: baseline.writeRevision, baseText: baseline.sourceText }
          await api.saveHistoryVersion(kind, entityId, historyOptions)
          saved = document
        } else {
          const options = { baseRevision: baseline.writeRevision, baseText: baseline.sourceText, ...(source ? { history: { source } } : { establishHistoryBaseline: true }) }
          const result = kind === 'chapter'
            ? await api.saveChapter(document as Partial<ChapterDoc>, options)
            : await api.saveOutlineDoc(document as OutlineDoc, options)
          saved = { ...document, ...result } as T
          const fresh = await api.getDocumentSnapshot(kind, entityId)
          if (fresh.writeRevision !== result.writeRevision) throw new Error('SOURCE_CHANGED：文档保存后再次变化，请比较当前文件后重试。')
          baseline = fresh
          saved = fresh.document as unknown as T
        }
        if (keyRef.current === scope && sessionRef.current === session) {
          // A write may finish while the user is typing. Keep the newer draft.
          const matches = documentFingerprint(current) === documentFingerprint(document)
          if (matches) current = saved
          callbackRef.current.onDocument(matches ? saved : current, !matches)
          await Promise.resolve(callbackRef.current.onSaved?.(saved)).catch(() => undefined)
        }
        return saved
      }
    })
    sessionRef.current = session
    rebaseRef.current = async () => {
      const fresh = await api.getDocumentSnapshot(kind, entityId)
      if (keyRef.current !== scope || sessionRef.current !== session) throw new Error('编辑会话已切换，请重试。')
      baseline = fresh
    }
    setState({ ...EMPTY_STATE })
    callbackRef.current.onDocument(current, false)
    // Store the latest draft synchronously for completions racing editor input.
    currentRef.current = (next) => { current = next }
  }
  const currentRef = useRef<(document: T) => void>(() => undefined)
  const change = (document: T): void => {
    editGenerationRef.current++
    currentRef.current(document)
    sessionRef.current?.update(document)
    callbackRef.current.onDocument(document, true)
  }
  const reset = (): void => { sessionRef.current?.dispose(); sessionRef.current = null; setState({ ...EMPTY_STATE }) }
  const save = async (source?: CaptureSource): Promise<boolean> => {
    const session = sessionRef.current
    if (!session) return false
    try { if (source) await session.capture(source); else await session.saveCurrent(); return true }
    catch (error) { setState((old) => ({ ...old, error: error instanceof Error ? error.message : String(error) })); return false }
  }
  const leave = async (allowDiscard = true): Promise<boolean> => {
    try { await sessionRef.current?.beforeLeave(); return true }
    catch (error) {
      setState((old) => ({ ...old, error: error instanceof Error ? error.message : String(error) }))
      if (allowDiscard && window.confirm('历史版本未成功保存，当前草稿仍在编辑器中。明确放弃本次改动并离开？')) { reset(); return true }
      return false
    }
  }
  const retry = async (): Promise<void> => {
    try { await sessionRef.current?.retry() } catch { /* The session exposes its error for the retry UI. */ }
  }
  const overwrite = async (): Promise<boolean> => {
    try { await rebaseRef.current?.(); await sessionRef.current?.saveCurrent(true); return true }
    catch (error) { setState((old) => ({ ...old, error: error instanceof Error ? error.message : String(error) })); return false }
  }
  useEffect(() => registerDocumentLeaveGuard(() => leave()), [workspaceKey])
  useEffect(() => {
    const visibility = (): void => {
      const session = sessionRef.current
      if (!session) return
      if (document.visibilityState === 'hidden') {
        void session.beforeLeave().catch(() => undefined)
      } else { void session.resume().catch(() => undefined) }
    }
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      if (sessionRef.current?.state.pendingHistory || sessionRef.current?.state.saving) { event.preventDefault(); event.returnValue = '' }
    }
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('beforeunload', beforeUnload)
    return () => { document.removeEventListener('visibilitychange', visibility); window.removeEventListener('beforeunload', beforeUnload); sessionRef.current?.dispose(); sessionRef.current = null }
  }, [workspaceKey])
  return { state, begin, change, save, leave, retry, reset, overwrite, editGeneration: () => editGenerationRef.current,
    compositionStart: () => sessionRef.current?.setComposing(true),
    compositionEnd: () => { const session = sessionRef.current; window.setTimeout(() => session?.setComposing(false), 0) }
  }
}
