export const HISTORY_INTERVAL_MS = 300_000
export type CaptureSource = 'manual' | 'automatic'
export interface EditSessionState { saving: boolean; pendingHistory: boolean; error: string | null; lastHistoryAt: number | null }
export class DocumentEditSession<T> {
  state: EditSessionState = { saving: false, pendingHistory: false, error: null, lastHistoryAt: null }
  private current: T
  private savedFingerprint: string
  private historyFingerprint: string
  private deadline: number | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private pending: Promise<void> | null = null
  private composing = false
  private disposed = false
  private failedSource: CaptureSource | 'current' | null = null
  constructor(private options: { initial: T; persist: (document: T, source?: CaptureSource) => Promise<T>; fingerprint: (document: T) => string; onState?: (state: EditSessionState) => void }) {
    this.current = options.initial
    this.savedFingerprint = this.historyFingerprint = options.fingerprint(options.initial)
  }
  get dirty(): boolean { return this.options.fingerprint(this.current) !== this.savedFingerprint }
  update(document: T): void {
    if (this.disposed) return
    this.current = document
    this.state.pendingHistory = this.options.fingerprint(document) !== this.historyFingerprint
    if (this.state.pendingHistory && this.deadline === null) this.deadline = (this.state.lastHistoryAt ?? Date.now()) + HISTORY_INTERVAL_MS
    this.emit()
    this.schedule()
  }
  setComposing(composing: boolean): void { this.composing = composing; if (!composing) this.schedule() }
  async saveCurrent(force = false): Promise<void> { await this.write(undefined, force) }
  async capture(source: CaptureSource): Promise<void> { await this.write(source) }
  async beforeLeave(): Promise<void> {
    if (this.composing) throw new Error('请先确认输入法候选字，再离开文档。')
    do {
      while (this.pending) await this.pending
      if (this.state.pendingHistory) await this.capture('automatic')
      else if (this.dirty) await this.saveCurrent()
    } while ((this.state.pendingHistory || this.dirty) && !this.disposed)
  }
  async retry(): Promise<void> {
    const source = this.failedSource
    this.state.error = null
    this.emit()
    if (source === 'current') await this.saveCurrent(true)
    else await this.capture(source ?? 'automatic')
  }
  async resume(): Promise<void> {
    if (this.deadline !== null && Date.now() >= this.deadline && !this.composing && !this.state.error) await this.capture('automatic')
  }
  dispose(): void { this.disposed = true; this.clearTimer() }
  private emit(): void { if (!this.disposed) this.options.onState?.({ ...this.state }) }
  private clearTimer(): void { if (this.timer !== null) clearTimeout(this.timer); this.timer = null }
  private schedule(): void {
    this.clearTimer()
    if (this.disposed || !this.state.pendingHistory || this.state.error || this.pending || this.composing || this.deadline === null) return
    this.timer = setTimeout(() => { this.timer = null; void this.capture('automatic').catch(() => undefined) }, Math.max(0, this.deadline - Date.now()))
  }
  private async write(source?: CaptureSource, force = false): Promise<void> {
    while (this.pending) await this.pending
    if (this.disposed) return
    if (this.composing) {
      if (source === 'automatic') return
      throw new Error('请先确认输入法候选字，再保存文档。')
    }
    if (source === 'automatic' && !this.state.pendingHistory) return
    if (!source && !this.dirty && !force) return
    const document = this.current
    const fingerprint = this.options.fingerprint(document)
    this.clearTimer()
    this.state.saving = true
    this.emit()
    const operation = (async () => {
      try {
        const saved = await this.options.persist(document, source)
        const savedFingerprint = this.options.fingerprint(saved)
        this.savedFingerprint = savedFingerprint
        if (this.options.fingerprint(this.current) === fingerprint) this.current = saved
        if (source) {
          this.historyFingerprint = savedFingerprint
          this.state.lastHistoryAt = Date.now()
          this.deadline = this.state.lastHistoryAt + HISTORY_INTERVAL_MS
        }
        this.state.pendingHistory = this.options.fingerprint(this.current) !== this.historyFingerprint
        this.state.error = null
        this.failedSource = null
      } catch (error) {
        this.state.error = error instanceof Error ? error.message : String(error)
        this.failedSource = source ?? 'current'
        throw error
      } finally {
        this.state.saving = false
        this.emit()
      }
    })()
    this.pending = operation
    try { await operation } finally { if (this.pending === operation) this.pending = null; this.schedule() }
  }
}
