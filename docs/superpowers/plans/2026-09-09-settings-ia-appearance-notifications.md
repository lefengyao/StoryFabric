# 设置信息架构与外观/通知设置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 设置页按类别分组并加顶部选择栏，新增自定义主题色与对话完成提示音。

**Architecture:** 主题色与提示音都先落成可单测的纯模块（`accent.ts` / `completionSound.ts`），再由 `settingsStore` 与 `chatStore` 接线；设置字段加进 `AppSettings` 后由既有的 `update` 合并与 `toPublic` 展开机制自动流转，只需补齐各端默认值。

**Tech Stack:** TypeScript, React 19, react-router-dom v7 (`useSearchParams`), Zustand, WebAudio, Vitest, Tailwind v4 CSS 变量。

**Spec:** `docs/superpowers/specs/2026-09-09-settings-ia-appearance-notifications-design.md`

---

## File map

- Create `src/renderer/src/lib/accent.ts`：主题色推导纯函数。
- Create `src/renderer/src/lib/__tests__/accent.test.ts`。
- Create `src/renderer/src/lib/completionSound.ts`：WebAudio 提示音。
- Create `src/renderer/src/lib/__tests__/completionSound.test.ts`。
- Modify `src/shared/types.ts`：`AppSettings` 加 3 个字段。
- Modify `src/shared/api.ts`：`SettingsPatch` Pick 列表。
- Modify `src/main/services/settingsService.ts`：`DEFAULT_SETTINGS`。
- Modify `src/server/settingsStore.ts`：默认值。
- Modify `src/renderer/src/platform/androidApi.ts`：`DEFAULT_PUBLIC`。
- Modify `src/renderer/src/stores/settingsStore.ts`：应用主题色。
- Modify `src/renderer/src/stores/chatStore.ts`：`done` 时播放提示音。
- Modify `src/renderer/src/pages/settings/SettingsPage.tsx`：tab 化 + 新控件。

---

## Task 1: 主题色推导（TDD）

**Files:** Create `src/renderer/src/lib/accent.ts`、`src/renderer/src/lib/__tests__/accent.test.ts`

- [x] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { accentStyle, accentTokens, isValidHexColor } from '../accent'

const sum = (hex: string): number => {
  const v = hex.replace('#', '')
  return parseInt(v.slice(0, 2), 16) + parseInt(v.slice(2, 4), 16) + parseInt(v.slice(4, 6), 16)
}

describe('isValidHexColor', () => {
  it('只接受 #rrggbb', () => {
    expect(isValidHexColor('#6366f1')).toBe(true)
    expect(isValidHexColor('#ABCDEF')).toBe(true)
    expect(isValidHexColor('6366f1')).toBe(false)
    expect(isValidHexColor('#6366f')).toBe(false)
    expect(isValidHexColor('#zzzzzz')).toBe(false)
    expect(isValidHexColor('')).toBe(false)
  })
})

describe('accentTokens', () => {
  it('保留基色并给出更深的 strong', () => {
    const tokens = accentTokens('#6366f1', false)
    expect(tokens.accent).toBe('#6366f1')
    expect(tokens.strong).not.toBe(tokens.accent)
    expect(sum(tokens.strong)).toBeLessThan(sum(tokens.accent))
  })

  it('浅色主题的 soft 很浅，深色主题的 soft 很暗', () => {
    expect(sum(accentTokens('#6366f1', false).soft)).toBeGreaterThan(700)
    expect(sum(accentTokens('#6366f1', true).soft)).toBeLessThan(120)
  })

  it('按基色亮度选择前景色', () => {
    expect(accentTokens('#6366f1', false).fg).toBe('#ffffff')
    expect(accentTokens('#fde047', false).fg).toBe('#18181b')
  })

  it('非法基色回退到该模式的默认色', () => {
    expect(accentTokens('nope', false).accent).toBe('#6366f1')
    expect(accentTokens('nope', true).accent).toBe('#818cf8')
  })
})

describe('accentStyle', () => {
  it('按主题选择对应基色并返回四个变量', () => {
    const light = accentStyle({ accentColorLight: '#dc2626', accentColorDark: '#22c55e' }, false)
    expect(light['--accent']).toBe('#dc2626')
    expect(Object.keys(light).sort()).toEqual(['--accent', '--accent-fg', '--accent-soft', '--accent-strong'])
    expect(accentStyle({ accentColorLight: '#dc2626', accentColorDark: '#22c55e' }, true)['--accent']).toBe('#22c55e')
  })

  it('缺省或非法时回退到默认色', () => {
    expect(accentStyle({}, false)['--accent']).toBe('#6366f1')
    expect(accentStyle({ accentColorLight: 'bad', accentColorDark: 'bad' }, true)['--accent']).toBe('#818cf8')
  })
})
```

- [x] **Step 2: 运行确认失败**

Run: `npm test -- --run src/renderer/src/lib/__tests__/accent.test.ts`
Expected: FAIL —— `Failed to resolve import "../accent"`。

- [x] **Step 3: 实现**

```ts
/** 主题色推导：由用户选的基色算出强调色家族，非法输入回退默认色。 */
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

export function accentTokens(hex: string, dark: boolean): AccentTokens {
  const base = isValidHexColor(hex) ? hex.trim().toLowerCase() : dark ? DEFAULT_DARK : DEFAULT_LIGHT
  const rgb = toRgb(base)
  const [h, s, l] = rgbToHsl(rgb)
  return {
    accent: base,
    strong: toHex(hslToRgb([h, s, Math.max(0, l - 0.08)])),
    soft: toHex(hslToRgb([h, Math.min(1, s), dark ? 0.14 : 0.94])),
    fg: relativeLuminance(rgb) > 0.55 ? '#18181b' : '#ffffff'
  }
}

export function accentStyle(settings: AccentSettings, dark: boolean): Record<string, string> {
  const base = (dark ? settings.accentColorDark : settings.accentColorLight) ?? (dark ? DEFAULT_DARK : DEFAULT_LIGHT)
  const tokens = accentTokens(base, dark)
  return { '--accent': tokens.accent, '--accent-strong': tokens.strong, '--accent-soft': tokens.soft, '--accent-fg': tokens.fg }
}
```

- [x] **Step 4: 运行确认通过**

Run: `npm test -- --run src/renderer/src/lib/__tests__/accent.test.ts`
Expected: PASS。

- [x] **Step 5: 提交**

```bash
git add src/renderer/src/lib/accent.ts src/renderer/src/lib/__tests__/accent.test.ts
git commit -m "feat(renderer): derive accent color tokens from a base color"
```

---

## Task 2: 设置字段与主题色应用

**Files:** Modify `src/shared/types.ts`、`src/shared/api.ts`、`src/main/services/settingsService.ts`、`src/server/settingsStore.ts`、`src/renderer/src/platform/androidApi.ts`、`src/renderer/src/stores/settingsStore.ts`

- [x] **Step 1: 扩展 `AppSettings`**

`src/shared/types.ts` 的 `AppSettings` 末尾追加：

```ts
  /** 智能体回答完成时播放提示音 */
  completionSound: boolean
  /** 浅色主题的强调色基色（#rrggbb） */
  accentColorLight: string
  /** 深色主题的强调色基色（#rrggbb） */
  accentColorDark: string
```

- [x] **Step 2: 补齐 `SettingsPatch`**

`src/shared/api.ts`：

```ts
export type SettingsPatch = Partial<
  Pick<
    PublicAppSettings,
    'theme' | 'defaultChatModel' | 'quickActionModel' | 'customPrompt' | 'showSessionLength' | 'completionSound' | 'accentColorLight' | 'accentColorDark'
  >
>
```

- [x] **Step 3: 三处默认值**

`src/main/services/settingsService.ts` 的 `DEFAULT_SETTINGS` 追加 `completionSound: false, accentColorLight: '#6366f1', accentColorDark: '#818cf8`；`src/server/settingsStore.ts` 与 `src/renderer/src/platform/androidApi.ts` 的 `DEFAULT_PUBLIC` 同步补齐同样的三个字段。

- [x] **Step 4: store 应用主题色**

`src/renderer/src/stores/settingsStore.ts` 整体替换为：

```ts
import { create } from 'zustand'
import type { PublicAppSettings } from '../../../shared/types'
import type { SettingsPatch } from '../../../shared/api'
import { getPlatformApi } from '../platform/platformApi'
import { accentStyle } from '../lib/accent'

interface SettingsState {
  settings: PublicAppSettings | null
  load: () => Promise<void>
  update: (patch: SettingsPatch) => Promise<void>
}

function applyTheme(theme: 'light' | 'dark' | 'system' | undefined): void {
  const t = theme ?? 'system'
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

/** 主题切换后必须重新计算强调色：深浅两套基色不同。 */
function applyAccent(settings: PublicAppSettings | null): void {
  const dark = document.documentElement.classList.contains('dark')
  const style = accentStyle(settings ?? {}, dark)
  for (const [key, value] of Object.entries(style)) document.documentElement.style.setProperty(key, value)
}

function applyAppearance(settings: PublicAppSettings | null): void {
  applyTheme(settings?.theme)
  applyAccent(settings)
}

export const useSettings = create<SettingsState>((set) => ({
  settings: null,

  load: async () => {
    const s = await getPlatformApi().getSettings()
    applyAppearance(s)
    set({ settings: s })
  },

  update: async (patch) => {
    const s = await getPlatformApi().updateSettings(patch)
    applyAppearance(s)
    set({ settings: s })
  }
}))
```

- [x] **Step 5: 类型检查与提交**

Run: `npx tsc -b --pretty false` → exit 0。

```bash
git add src/shared/types.ts src/shared/api.ts src/main/services/settingsService.ts src/server/settingsStore.ts src/renderer/src/platform/androidApi.ts src/renderer/src/stores/settingsStore.ts
git commit -m "feat: add completion sound and accent color settings"
```

---

## Task 3: 提示音模块（TDD）

**Files:** Create `src/renderer/src/lib/completionSound.ts`、`src/renderer/src/lib/__tests__/completionSound.test.ts`

- [x] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { createCompletionSound, shouldPlayCompletionSound, type AudioContextLike } from '../completionSound'

function fakeContext(): { ctx: AudioContextLike; tones: Array<{ type: string; freq: number; started: number; stopped: number }>; gains: number[][]; closed: boolean } {
  const state = { tones: [] as Array<{ type: string; freq: number; started: number; stopped: number }>, gains: [] as number[][], closed: false }
  const ctx: AudioContextLike = {
    currentTime: 0,
    destination: {},
    createOscillator: () => {
      const tone = { type: '', freq: 0, started: 0, stopped: 0 }
      state.tones.push(tone)
      return {
        get type() { return tone.type },
        set type(v: string) { tone.type = v },
        frequency: { setValueAtTime: (v: number) => { tone.freq = v } },
        connect: () => {},
        start: (t: number) => { tone.started = t },
        stop: (t: number) => { tone.stopped = t }
      }
    },
    createGain: () => {
      const envelope: number[] = []
      state.gains.push(envelope)
      return {
        gain: {
          setValueAtTime: (v: number) => { envelope.push(v) },
          exponentialRampToValueAtTime: (v: number) => { envelope.push(v) }
        },
        connect: () => {}
      }
    },
    close: async () => { state.closed = true }
  }
  return { ctx, tones: state.tones, gains: state.gains, closed: false }
}

describe('shouldPlayCompletionSound', () => {
  it('只在开关打开且本次没有出错时播放', () => {
    expect(shouldPlayCompletionSound({ enabled: true, error: false })).toBe(true)
    expect(shouldPlayCompletionSound({ enabled: true, error: true })).toBe(false)
    expect(shouldPlayCompletionSound({ enabled: false, error: false })).toBe(false)
  })
})

describe('createCompletionSound', () => {
  it('播放两个渐弱音', () => {
    const { ctx, tones, gains } = fakeContext()
    const sound = createCompletionSound(() => ctx)
    sound.play()
    expect(tones).toHaveLength(2)
    expect(tones[0].freq).toBeCloseTo(880, 1)
    expect(tones[1].freq).toBeCloseTo(1174.66, 1)
    expect(tones.every((t) => t.stopped > t.started)).toBe(true)
    expect(gains[0][0]).toBeLessThan(gains[0][1])
    expect(gains[0][2]).toBeLessThan(gains[0][1])
  })

  it('上下文创建失败时静默', () => {
    const sound = createCompletionSound(() => null)
    expect(() => sound.play()).not.toThrow()
  })

  it('dispose 关闭上下文', async () => {
    let closeCalled = false
    const ctx = { ...fakeContext().ctx, close: async () => { closeCalled = true } }
    const sound = createCompletionSound(() => ctx)
    sound.play()
    sound.dispose()
    await Promise.resolve()
    expect(closeCalled).toBe(true)
  })
})
```

- [x] **Step 2: 运行确认失败**

Run: `npm test -- --run src/renderer/src/lib/__tests__/completionSound.test.ts`
Expected: FAIL —— 模块不存在。

- [x] **Step 3: 实现**

```ts
/** 智能体回答完成提示音：WebAudio 合成，不打包音频资源。 */

export interface AudioContextLike {
  currentTime: number
  destination: unknown
  createOscillator(): {
    type: string
    frequency: { setValueAtTime(value: number, time: number): void }
    connect(target: unknown): void
    start(time: number): void
    stop(time: number): void
  }
  createGain(): {
    gain: {
      setValueAtTime(value: number, time: number): void
      exponentialRampToValueAtTime(value: number, time: number): void
    }
    connect(target: unknown): void
  }
  close?(): Promise<void>
}

const PEAK = 0.15
const FLOOR = 0.0001
const NOTES = [
  { frequency: 880, offset: 0, duration: 0.18 },
  { frequency: 1174.66, offset: 0.14, duration: 0.32 }
]

export function shouldPlayCompletionSound(input: { enabled: boolean; error: boolean }): boolean {
  return input.enabled && !input.error
}

function defaultContext(): AudioContextLike | null {
  try {
    const Ctor = (globalThis as { AudioContext?: new () => AudioContextLike }).AudioContext
    return Ctor ? new Ctor() : null
  } catch {
    return null
  }
}

export function createCompletionSound(createContext: () => AudioContextLike | null = defaultContext): { play: () => void; dispose: () => void } {
  let ctx: AudioContextLike | null = null

  const ensure = (): AudioContextLike | null => {
    if (!ctx) ctx = createContext()
    return ctx
  }

  return {
    play: (): void => {
      try {
        const audio = ensure()
        if (!audio) return
        const start = audio.currentTime
        for (const note of NOTES) {
          const gain = audio.createGain()
          const at = start + note.offset
          gain.gain.setValueAtTime(FLOOR, at)
          gain.gain.exponentialRampToValueAtTime(PEAK, at + 0.02)
          gain.gain.exponentialRampToValueAtTime(FLOOR, at + note.duration)
          gain.connect(audio.destination)
          const oscillator = audio.createOscillator()
          oscillator.type = 'sine'
          oscillator.frequency.setValueAtTime(note.frequency, at)
          oscillator.connect(gain)
          oscillator.start(at)
          oscillator.stop(at + note.duration + 0.02)
        }
      } catch {
        /* 自动播放策略或音频不可用时静默 */
      }
    },
    dispose: (): void => {
      const audio = ctx
      ctx = null
      void audio?.close?.().catch(() => {})
    }
  }
}

const shared = createCompletionSound()

export function playCompletionSound(): void {
  shared.play()
}
```

- [x] **Step 4: 运行确认通过**

Run: `npm test -- --run src/renderer/src/lib/__tests__/completionSound.test.ts`
Expected: PASS。

- [x] **Step 5: 提交**

```bash
git add src/renderer/src/lib/completionSound.ts src/renderer/src/lib/__tests__/completionSound.test.ts
git commit -m "feat(renderer): synthesize a completion chime"
```

---

## Task 4: 接线（chatStore + 设置页）

**Files:** Modify `src/renderer/src/stores/chatStore.ts`、`src/renderer/src/pages/settings/SettingsPage.tsx`

- [x] **Step 1: `done` 事件播放提示音**

`src/renderer/src/stores/chatStore.ts` 顶部 import：

```ts
import { playCompletionSound, shouldPlayCompletionSound } from '../lib/completionSound'
import { useSettings } from './settingsStore'
```

`case 'done':` 改为：

```ts
    case 'done': {
      const enabled = useSettings.getState().settings?.completionSound ?? false
      if (shouldPlayCompletionSound({ enabled, error: get().error !== null })) playCompletionSound()
      break
    }
```

- [x] **Step 2: 设置页 tab 化**

`SettingsPage.tsx` 的返回结构改为：

```tsx
const TABS = [
  { key: 'models', label: '模型与供应商' },
  { key: 'agent', label: '智能体' },
  { key: 'appearance', label: '外观' },
  { key: 'notifications', label: '通知' }
] as const

type TabKey = (typeof TABS)[number]['key']

export function SettingsPage(): React.ReactElement {
  const [params, setParams] = useSearchParams()
  const active = (TABS.find((t) => t.key === params.get('tab'))?.key ?? 'models') as TabKey
  ...
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-4 py-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setParams({ tab: tab.key })}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs ${active === tab.key ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-elevated'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
          {active === 'models' && <>{/* 供应商 section + 默认模型 section 原样 */}</>}
          {active === 'agent' && <>{/* 智能体 section 原样 */}</>}
          {active === 'appearance' && <>{/* 主题 + 主题色 */}</>}
          {active === 'notifications' && <>{/* 提示音 */}</>}
        </div>
      </div>
      {/* 供应商编辑弹窗原样 */}
    </div>
  )
}
```

- [x] **Step 3: 外观 tab 的主题色控件**

```tsx
const ACCENT_PRESETS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']

<Card className="space-y-4 p-4">
  <Field label="主题色（浅色）">
    <div className="flex items-center gap-2">
      <input type="color" value={settings.accentColorLight} onChange={(e) => void update({ accentColorLight: e.target.value })} className="h-8 w-12 rounded border border-line bg-panel" />
      <Input value={settings.accentColorLight} onChange={(e) => void update({ accentColorLight: e.target.value })} className="max-w-32 font-mono text-xs" />
      <Button size="sm" onClick={() => void update({ accentColorLight: '#6366f1' })}>重置</Button>
    </div>
  </Field>
  <Field label="主题色（深色）">
    <div className="flex items-center gap-2">
      <input type="color" value={settings.accentColorDark} onChange={(e) => void update({ accentColorDark: e.target.value })} className="h-8 w-12 rounded border border-line bg-panel" />
      <Input value={settings.accentColorDark} onChange={(e) => void update({ accentColorDark: e.target.value })} className="max-w-32 font-mono text-xs" />
      <Button size="sm" onClick={() => void update({ accentColorDark: '#818cf8' })}>重置</Button>
    </div>
  </Field>
  <div className="flex flex-wrap gap-2">
    {ACCENT_PRESETS.map((color) => (
      <button key={color} title={color} onClick={() => void update({ accentColorLight: color, accentColorDark: color })} className="h-6 w-6 rounded-full border border-line" style={{ background: color }} />
    ))}
  </div>
</Card>
```

- [x] **Step 4: 通知 tab**

```tsx
<Card className="flex items-center justify-between gap-4 p-4">
  <div>
    <div className="text-sm">对话完成提示音</div>
    <div className="mt-0.5 text-xs text-muted">智能体回答完成时播放一声柔和提示音</div>
  </div>
  <div className="flex items-center gap-2">
    <Button size="sm" onClick={() => playCompletionSound()}>试听</Button>
    <label className="flex items-center gap-2.5 text-sm">
      <input type="checkbox" checked={settings.completionSound} onChange={(e) => void update({ completionSound: e.target.checked })} className="h-4 w-4 accent-[var(--accent)]" />
      启用
    </label>
  </div>
</Card>
```

复选框沿用仓库既有写法（`SettingsPage.tsx:159-167` 的 `accent-[var(--accent)]`），不引入新的 Switch 组件。

- [x] **Step 5: 类型检查、构建、提交**

Run: `npx tsc -b --pretty false` → exit 0
Run: `npm run build` → exit 0

```bash
git add src/renderer/src/stores/chatStore.ts src/renderer/src/pages/settings/SettingsPage.tsx
git commit -m "feat(renderer): tabbed settings with accent and chime controls"
```

---

## Task 5: 验证与人工确认

- [x] **Step 1: 全量测试与类型检查**

Run: `npm test -- --run` → 29 文件全部通过
Run: `npx tsc -b --pretty false` → exit 0

- [x] **Step 2: 打包并启动**

Run: `npm run dist:win` → exit 0
Run: 启动 `release/win-unpacked/StoryFabric.exe`，确认：设置页出现四个 tab 且可切换；改主题色后强调色即时变化；深浅主题各用各自的基色；「试听」能听到提示音；开关关闭后完成对话不响。

- [x] **Step 3: 更新 backlog 与文档**

在 `docs/superpowers/backlog.md` 勾掉设置分类 / 提示音 / 主题色三项，写 checkpoint。
