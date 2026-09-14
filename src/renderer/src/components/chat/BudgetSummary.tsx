export function BudgetSummary({ maxCalls, usedCalls, maxTokens, usedTokens }: { maxCalls: number; usedCalls: number; maxTokens: number; usedTokens: number }): React.ReactElement {
  return <div className="rounded-lg border border-line bg-panel px-3 py-2 text-xs text-muted"><span>预计额度</span><strong className="ml-2 text-fg">{usedCalls}/{maxCalls} 次 · {usedTokens.toLocaleString()}/{maxTokens.toLocaleString()} token</strong></div>
}
