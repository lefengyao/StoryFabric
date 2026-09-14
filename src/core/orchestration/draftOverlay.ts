export class DraftOverlay {
  private readonly values = new Map<string, unknown>()

  propose(key: string, value: unknown): void { this.values.set(key, value) }
  get<T = unknown>(key: string): T | undefined { return this.values.get(key) as T | undefined }
  entries(): Array<[string, unknown]> { return [...this.values.entries()] }
  toJSON(): Record<string, unknown> { return Object.fromEntries(this.values) }
}
