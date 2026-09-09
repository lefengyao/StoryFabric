/** 编辑器外观：把设置翻译成 CSS 变量，非法值夹紧或回落，保证默认观感与改动前一致。 */
export type EditorFontFamily = 'sans' | 'serif' | 'mono'

export interface EditorAppearance {
  editorFontSize?: number
  editorLineHeight?: number
  editorFontFamily?: EditorFontFamily
}

export const EDITOR_FONT_SIZES = [13, 14, 16, 18, 20] as const
export const EDITOR_LINE_HEIGHTS = [1.5, 1.75, 1.9, 2.2] as const

const FONT_STACKS: Record<EditorFontFamily, string> = {
  sans: "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  serif: "'Songti SC', 'SimSun', Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace"
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function editorStyle(settings: EditorAppearance): Record<string, string> {
  const size = clamp(settings.editorFontSize ?? 14, 12, 24)
  const lineHeight = clamp(settings.editorLineHeight ?? 1.75, 1.2, 3)
  const family = FONT_STACKS[settings.editorFontFamily ?? 'sans'] ?? FONT_STACKS.sans
  return {
    '--editor-font-size': `${size}px`,
    '--editor-line-height': String(lineHeight),
    '--editor-font': family
  }
}
