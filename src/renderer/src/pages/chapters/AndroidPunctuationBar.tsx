const SYMBOLS = ['，', '。', '？', '！', '、', '：', '；', '“', '”', '（', '）', '…', '—', '「', '」']

export function AndroidPunctuationBar({ visible, pending, onInsert }: { visible: boolean; pending: string; onInsert: (text: string) => void }): React.ReactElement | null {
  if (!visible) return null
  return (
    <div className="shrink-0">
    {pending && <p role="status" className="border-t border-line bg-panel px-2 py-1 text-xs text-muted">确认候选字后插入 {pending}</p>}
    <div data-punctuation-bar role="toolbar" aria-label="常用标点" className="punctuation-bar">
      {SYMBOLS.map((symbol) => <button type="button" key={symbol} aria-label={`插入 ${symbol}`} onPointerDown={(event) => event.preventDefault()} onMouseDown={(event) => event.preventDefault()} onClick={() => onInsert(symbol)}>{symbol}</button>)}
    </div>
    </div>
  )
}
