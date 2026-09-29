export class ActiveRunTracker {
  private activeRuns = 0

  constructor(private readonly onChange: (active: boolean) => void) {}

  begin(): () => void {
    if (this.activeRuns++ === 0) this.onChange(true)
    let finished = false
    return () => {
      if (finished) return
      finished = true
      this.activeRuns = Math.max(0, this.activeRuns - 1)
      if (this.activeRuns === 0) this.onChange(false)
    }
  }
}
