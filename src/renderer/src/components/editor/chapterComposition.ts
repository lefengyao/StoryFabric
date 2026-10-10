import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view'
import { chapterParagraphIndent } from '../../lib/chapterEditor'
import { externalEditorChange } from '../../lib/editorChange'
import { Facet } from '@codemirror/state'

export const chapterPendingInput = Facet.define<(text: string) => void>()

/** Keep IME candidate replacement intact, then indent the committed paragraph. */
class ChapterComposition {
  private paragraph: number | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private editContext: EventTarget | null = null
  private pendingText = ''
  private pendingActions: Array<() => void> = []
  private contextStart = (): void => this.start()
  private contextEnd = (): void => this.finish()

  constructor(private view: EditorView) {}

  start(): void {
    this.cancel(false)
    const line = this.view.state.doc.lineAt(this.view.state.selection.main.from)
    if (!line.text) this.paragraph = line.from
  }

  finish(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    // Android IMEs can deliver their final DOM mutations after compositionend.
    this.timer = setTimeout(() => {
      this.timer = null
      if (this.view.compositionStarted) return
      const position = this.paragraph
      this.paragraph = null
      if (position !== null) {
        const state = this.view.state
        const indent = chapterParagraphIndent(state.doc, position)
        if (indent) {
          const changes = state.changes(indent)
          this.view.dispatch({ changes, selection: state.selection.map(changes), userEvent: 'input.type' })
        }
      }
      if (this.pendingText) {
        const text = this.pendingText
        this.pendingText = ''
        this.view.dispatch({ ...this.view.state.replaceSelection(text), userEvent: 'input.type', scrollIntoView: true })
        this.notifyPending()
      }
      const actions = this.pendingActions.splice(0)
      actions.forEach((action) => action())
    }, 60)
  }

  queueText(text: string): boolean {
    if (!this.view.compositionStarted && this.timer === null) return false
    // Replacing the DOM during an Android IME preedit can strand its Latin text.
    // Wait for the candidate commit, keeping the editor and keyboard focused.
    this.pendingText += text
    this.notifyPending()
    return true
  }

  queueAction(action: () => void): boolean {
    if (!this.view.compositionStarted && this.timer === null) return false
    this.pendingActions.push(action)
    return true
  }

  private notifyPending(): void {
    this.view.state.facet(chapterPendingInput).forEach((listener) => listener(this.pendingText))
  }

  update(update: ViewUpdate): void {
    // New Chromium versions route composition through EditContext instead of DOM.
    this.bindEditContext()
    if (update.transactions.some((tr) => tr.annotation(externalEditorChange))) { this.cancel(); return }
    if (this.paragraph === null) {
      const first = update.transactions.find((tr) => tr.isUserEvent('input.type.compose.start'))
      if (first) {
        const line = first.startState.doc.lineAt(first.startState.selection.main.from)
        if (!line.text) this.paragraph = line.from
      }
    }
    if (this.paragraph !== null) this.paragraph = update.changes.mapPos(this.paragraph, -1)
  }

  private bindEditContext(): void {
    const context = (this.view.contentDOM as HTMLElement & { editContext?: EventTarget | null }).editContext ?? null
    if (context === this.editContext) return
    this.editContext?.removeEventListener('compositionstart', this.contextStart)
    this.editContext?.removeEventListener('compositionend', this.contextEnd)
    this.editContext = context
    context?.addEventListener('compositionstart', this.contextStart)
    context?.addEventListener('compositionend', this.contextEnd)
  }

  private cancel(discardPending = true): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    this.paragraph = null
    if (discardPending && this.pendingText) { this.pendingText = ''; this.notifyPending() }
    if (discardPending) this.pendingActions = []
  }

  destroy(): void {
    this.cancel()
    this.editContext?.removeEventListener('compositionstart', this.contextStart)
    this.editContext?.removeEventListener('compositionend', this.contextEnd)
  }
}

export const chapterCompositionFormatting = ViewPlugin.fromClass(ChapterComposition, {
  eventHandlers: {
    compositionstart() { this.start(); return false },
    compositionend() { this.finish(); return false }
  }
})

export function insertChapterText(view: EditorView, text: string): void {
  if (!view.plugin(chapterCompositionFormatting)?.queueText(text)) {
    view.dispatch({ ...view.state.replaceSelection(text), userEvent: 'input.type', scrollIntoView: true })
  }
  view.focus()
}

export function afterChapterComposition(view: EditorView, action: () => void): boolean {
  if (view.plugin(chapterCompositionFormatting)?.queueAction(action)) return true
  action()
  return false
}
