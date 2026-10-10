export interface WritingToolsPreferences {
  customWords: string[]
  hiddenWords: string[]
}

function normalizeWords(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const words = value.filter((word): word is string => typeof word === 'string')
    .map((word) => word.trim()).filter((word) => word.length > 0 && word.length <= 80 && !/[\r\n\x00-\x1f]/.test(word))
  return [...new Set(words)].slice(0, 200)
}

export function normalizeWritingTools(value: unknown): WritingToolsPreferences {
  const input = value && typeof value === 'object' ? value as Partial<WritingToolsPreferences> : {}
  return { customWords: normalizeWords(input.customWords), hiddenWords: normalizeWords(input.hiddenWords) }
}

export function suggestedWritingWords(summary: { characters?: { name: string; aliases?: string[] }[]; settings?: { title: string }[] }): string[] {
  return normalizeWords([...(summary.characters ?? []).flatMap((character) => [character.name, ...(character.aliases ?? [])]), ...(summary.settings ?? []).map((setting) => setting.title)])
}

export function visibleWritingWords(suggestions: string[], preferences: WritingToolsPreferences): string[] {
  const hidden = new Set(preferences.hiddenWords)
  return normalizeWords([...preferences.customWords, ...suggestions.filter((word) => !hidden.has(word))])
}
