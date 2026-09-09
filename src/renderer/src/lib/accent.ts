/** 主题色推导：由用户选的基色算出强调色家族。默认基色交给 index.css 的手工配色，只有自定义时才运行时覆盖。 */
export interface AccentTokens {
  accent: string
  strong: string
  soft: string
  fg: string
}

export interface AccentSettings {
  accentColorLight?: string
  accentColorDark?: string
}

const DEFAULT_LIGHT = '#6366f1'
const DEFAULT_DARK = '#818cf8'
const FG_LIGHT = '#ffffff'
const FG_DARK = '#18181b'

export function isValidHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test((value ?? '').trim())
}

type Rgb = [number, number, number]

function toRgb(hex: string): Rgb {
  const v = hex.trim().replace('#', '')
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)]
}

function toHex([r, g, b]: Rgb): string {
  const clamp = (c: number): number => Math.round(Math.min(255, Math.max(0, c)))
  return `#${[clamp(r), clamp(g), clamp(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
  else if (max === gn) h = ((bn - rn) / d + 2) / 6
  else h = ((rn - gn) / d + 4) / 6
  return [h, s, l]
}

function hslToRgb([h, s, l]: [number, number, number]): Rgb {
  if (s === 0) {
    const v = l * 255
    return [v, v, v]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number): number => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return [channel(h + 1 / 3) * 255, channel(h) * 255, channel(h - 1 / 3) * 255]
}

function relativeLuminance([r, g, b]: Rgb): number {
  const f = (c: number): number => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/** WCAG 对比度（1–21）。 */
function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** 取对比度更高的前景色，而不是拍一个亮度阈值。 */
function pickForeground(rgb: Rgb): string {
  return contrastRatio(rgb, toRgb(FG_DARK)) >= contrastRatio(rgb, toRgb(FG_LIGHT)) ? FG_DARK : FG_LIGHT
}

export function accentTokens(hex: string, dark: boolean): AccentTokens {
  const base = isValidHexColor(hex) ? hex.trim().toLowerCase() : dark ? DEFAULT_DARK : DEFAULT_LIGHT
  const rgb = toRgb(base)
  const [h, s, l] = rgbToHsl(rgb)
  // 极暗基色无法再压暗，改为提亮，保证 strong 与 accent 可区分。
  const strongL = l >= 0.12 ? l - 0.08 : Math.min(1, l + 0.12)
  return {
    accent: base,
    strong: toHex(hslToRgb([h, s, strongL])),
    // soft 是底衬色，需要低饱和，否则深色主题会出现刺眼的高饱和深蓝。
    soft: toHex(hslToRgb([h, s * 0.35, dark ? 0.16 : 0.95])),
    fg: pickForeground(rgb)
  }
}

export function accentStyle(settings: AccentSettings, dark: boolean): Record<string, string> {
  const fallback = dark ? DEFAULT_DARK : DEFAULT_LIGHT
  const base = (dark ? settings.accentColorDark : settings.accentColorLight) ?? fallback
  // 默认基色或非法值：不写内联变量，交由 index.css 的手工配色，避免默认外观被推导值改变。
  if (!isValidHexColor(base) || base.trim().toLowerCase() === fallback) return {}
  const tokens = accentTokens(base, dark)
  return { '--accent': tokens.accent, '--accent-strong': tokens.strong, '--accent-soft': tokens.soft, '--accent-fg': tokens.fg }
}
