# 模型能力管理与思考强度映射 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把模型配置从供应商小窗里的文本框升级为独立整页「模型管理」，并让用户自行声明模型能力（拓展思考 / 图片输入）与官方思考强度映射，映射在智能体发请求时生效。

**Architecture:** 数据落在 `ModelSettings`（三端持久化，可选字段，无需迁移）；纯逻辑放 core（`reasoningMap.ts` 解析/写入，`modelParams.ts` 组装请求体片段，`modelCatalog.ts` 提供档案默认值）；渲染层只做 UI 与纯函数（`modelCapability.ts`）；协议适配器不改结构，映射通过 `buildModelParams` 自然进入请求体。

**Tech Stack:** Electron + React 19 + TypeScript + Zustand + Tailwind v4 + Vitest 4；core 层平台无关，桌面/服务端/Android 三端共用。

**Spec:** `docs/superpowers/specs/2026-09-09-model-capability-management-design.md`

---

## File Structure

**新建**

| 文件 | 职责 |
| --- | --- |
| `src/core/llm/reasoningMap.ts` | 映射值解析（JSON 字面量或裸字符串）与点路径写入请求体 |
| `src/core/llm/__tests__/reasoningMap.test.ts` | 上述纯函数单测 |
| `src/renderer/src/lib/modelCapability.ts` | UI 纯逻辑：能力解析、模型增删/搜索/候选差集、映射编辑与校验 |
| `src/renderer/src/lib/__tests__/modelCapability.test.ts` | 上述纯函数单测 |
| `src/renderer/src/pages/settings/ModelManagerView.tsx` | 模型管理整页（拉取/勾选/手动添加/搜索/逐模型展开面板/保存） |

**修改**

| 文件 | 改动 |
| --- | --- |
| `src/shared/types.ts` | 新增 `ReasoningMap`；`ModelSettings` 加 `reasoningSupport` / `vision` / `reasoningMap` |
| `src/core/llm/types.ts` | `ModelParams` 加可选 `reasoningSupport` / `reasoningMap` |
| `src/core/llm/modelCatalog.ts` | `ModelProfile` 加 `vision`；各档案补值；`resolveModelSettings` 透传新字段 |
| `src/core/llm/modelParams.ts` | `buildModelParams` 应用映射、支持开关 |
| `src/core/llm/__tests__/modelCatalog.test.ts` | 新字段与 vision 默认值断言 |
| `src/core/llm/__tests__/modelParams.test.ts` | 映射与开关断言 |
| `src/core/llm/__tests__/adapters.test.ts` | 映射落到真实请求体 |
| `src/main/services/__tests__/settingsService.test.ts` | 往返含新字段 |
| `src/server/__tests__/server.test.ts` | RPC 往返含新字段 |
| `src/renderer/src/pages/settings/SettingsPage.tsx` | 小窗瘦身 + 「管理模型」入口 + 渲染整页视图 |
| `src/renderer/src/pages/chat/ChatPage.tsx` | 模型下拉加能力后缀 |

**不改**：协议适配器（`openaiCompatible.ts` / `anthropic.ts` / `gemini.ts`）、三端默认值（新字段可选，自动透传）、`pruneModelSettings`（按模型名过滤整对象）。

---

### Task 1: 扩展共享类型

**Files:**
- Modify: `src/shared/types.ts:223-233`

- [ ] **Step 1: 替换 `ReasoningLevel` 之后到 `ModelSettings` 结束的整段**

```ts
/** 推理等级：off 表示不发送推理参数 */
export type ReasoningLevel = 'off' | 'low' | 'medium' | 'high'

/** 官方思考强度 → 本地等级的映射（用户自填，因无法可靠拉取） */
export interface ReasoningMap {
  /** 请求体里的参数路径，点号分隔：reasoning_effort / thinking.type / generationConfig.thinkingConfig.thinkingBudget */
  path: string
  /** 各等级对应的值（保留用户输入原文，发送时解析） */
  values: Partial<Record<ReasoningLevel, string>>
}

/** 单个模型的参数覆盖 */
export interface ModelSettings {
  /** 是否支持拓展思考（缺省回落到内置档案） */
  reasoningSupport?: boolean
  /** 是否支持图片输入（缺省回落到内置档案） */
  vision?: boolean
  reasoning?: ReasoningLevel
  /** 官方思考强度映射；填了则优先于协议内置形式 */
  reasoningMap?: ReasoningMap
  /** 该模型的上下文窗口（仅记录/展示，协议无此参数） */
  contextTokens?: number
  /** 单次回复输出上限 */
  maxOutputTokens?: number
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc -b --pretty false`
Expected: exit 0（新增字段全部可选，现有代码不受影响）

- [ ] **Step 3: 提交**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add model capability and reasoning map fields"
```

---

### Task 2: 映射解析与点路径写入（TDD）

**Files:**
- Create: `src/core/llm/__tests__/reasoningMap.test.ts`
- Create: `src/core/llm/reasoningMap.ts`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, expect, it } from 'vitest'
import { parseReasoningValue, setByPath } from '../reasoningMap'

describe('parseReasoningValue', () => {
  it('解析数字、布尔与带引号字符串', () => {
    expect(parseReasoningValue('2048')).toBe(2048)
    expect(parseReasoningValue('true')).toBe(true)
    expect(parseReasoningValue('"low"')).toBe('low')
  })

  it('非 JSON 时按裸字符串处理，并去掉首尾空白', () => {
    expect(parseReasoningValue('low')).toBe('low')
    expect(parseReasoningValue('  high  ')).toBe('high')
  })

  it('空值返回 undefined', () => {
    expect(parseReasoningValue('')).toBeUndefined()
    expect(parseReasoningValue('   ')).toBeUndefined()
    expect(parseReasoningValue(undefined)).toBeUndefined()
  })
})

describe('setByPath', () => {
  it('写入单层路径', () => {
    const body: Record<string, unknown> = {}
    setByPath(body, 'reasoning_effort', 'high')
    expect(body).toEqual({ reasoning_effort: 'high' })
  })

  it('逐级建对象，且不覆盖已有同级字段', () => {
    const body: Record<string, unknown> = { generationConfig: { maxOutputTokens: 8192 } }
    setByPath(body, 'generationConfig.thinkingConfig.thinkingBudget', 4096)
    expect(body).toEqual({
      generationConfig: { maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 4096 } }
    })
  })

  it('路径为空或含空段时忽略', () => {
    const body: Record<string, unknown> = {}
    setByPath(body, '', 1)
    setByPath(body, 'a..b', 1)
    setByPath(body, '.a', 1)
    setByPath(body, 'a.', 1)
    expect(body).toEqual({})
  })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run src/core/llm/__tests__/reasoningMap.test.ts`
Expected: FAIL —— 无法解析模块 `../reasoningMap`

- [ ] **Step 3: 最小实现**

```ts
/** 官方思考强度映射：值解析与点路径写入。 */

/**
 * 空/空白 → undefined；先按 JSON 解析（2048 / true / "low"），
 * 失败则按裸字符串（low → 'low'），这样用户不必给字符串加引号。
 */
export function parseReasoningValue(raw?: string): unknown | undefined {
  if (typeof raw !== 'string') return undefined
  const text = raw.trim()
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

/** 按点路径逐级建对象写入；路径为空或含空段时忽略。已有同级字段不会被清空。 */
export function setByPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.').map((s) => s.trim())
  if (segments.some((s) => !s)) return
  let cursor = target
  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i]
    const next = cursor[key]
    if (typeof next !== 'object' || next === null || Array.isArray(next)) cursor[key] = {}
    cursor = cursor[key] as Record<string, unknown>
  }
  cursor[segments[segments.length - 1]] = value
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `npx vitest run src/core/llm/__tests__/reasoningMap.test.ts`
Expected: PASS（7 个用例）

- [ ] **Step 5: 提交**

```bash
git add src/core/llm/reasoningMap.ts src/core/llm/__tests__/reasoningMap.test.ts
git commit -m "feat(core): add reasoning map value parsing and dot-path writer"
```

---

### Task 3: 档案 vision + 解析透传（TDD）

**Files:**
- Modify: `src/core/llm/__tests__/modelCatalog.test.ts`
- Modify: `src/core/llm/types.ts:15-19`
- Modify: `src/core/llm/modelCatalog.ts:4-24`、`:27-100`、`:116-127`

- [ ] **Step 1: 追加失败的测试**（加在 `describe('resolveModelSettings', ...)` 内）

```ts
  it('用户声明优先：明确开关覆盖档案，未表态时保持 undefined', () => {
    expect(resolveModelSettings({}, 'gpt-4o').reasoningSupport).toBeUndefined()
    expect(
      resolveModelSettings({ modelSettings: { 'deepseek-chat': { reasoningSupport: true } } }, 'deepseek-chat').reasoningSupport
    ).toBe(true)
    expect(
      resolveModelSettings({ modelSettings: { 'gpt-5': { reasoningSupport: false } } }, 'gpt-5').reasoningSupport
    ).toBe(false)
  })

  it('映射原样透传给请求构建层', () => {
    const map = { path: 'enable_thinking', values: { low: 'true' } }
    expect(resolveModelSettings({ modelSettings: { x: { reasoningMap: map } } }, 'x').reasoningMap).toEqual(map)
  })
```

同文件追加一个独立 describe：

```ts
describe('模型档案的图片能力默认值', () => {
  it('多模态家族默认 true，其余默认 false', () => {
    expect(profileForModel('gpt-4o').vision).toBe(true)
    expect(profileForModel('claude-sonnet-4-5').vision).toBe(true)
    expect(profileForModel('gemini-2.5-pro').vision).toBe(true)
    expect(profileForModel('deepseek-chat').vision).toBe(false)
    expect(profileForModel('some-internal-model').vision).toBe(false)
  })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run src/core/llm/__tests__/modelCatalog.test.ts`
Expected: FAIL —— `vision` 不存在 / `reasoningSupport` 为 undefined 断言失败

- [ ] **Step 3: 扩展 `ModelParams`**

`src/core/llm/types.ts` 整段替换：

```ts
export interface ModelParams {
  reasoning: ReasoningLevel
  /** 用户声明优先；缺省时 `buildModelParams` 回落到内置档案 */
  reasoningSupport?: boolean
  /** 官方思考强度映射；缺省或该等级没填时回落内置形式 */
  reasoningMap?: ReasoningMap
  contextTokens: number
  maxOutputTokens: number
}
```

同时把第 2 行 import 改为：

```ts
import type { ChatMessage, Protocol, ReasoningLevel, ReasoningMap, ToolCallData, ToolDefJson } from '../../shared/types'
```

- [ ] **Step 4: 给 `ModelProfile` 加 `vision` 并补齐所有档案**

`src/core/llm/modelCatalog.ts` 的 `ModelProfile` 接口替换为：

```ts
/** 模型能力档案：只用于「默认值」与「参数形式」，用户可逐模型覆盖。 */
export interface ModelProfile {
  /** 便于调试/展示的家族标签 */
  label: string
  contextTokens: number
  maxOutputTokens: number
  /** OpenAI 兼容协议应使用的输出上限字段名 */
  openaiOutputParam: 'max_tokens' | 'max_completion_tokens'
  /** 是否支持推理等级（具体参数形式由协议决定） */
  reasoning: boolean
  /** 是否支持图片输入（仅作开关初值，用户可覆盖） */
  vision: boolean
}
```

`GENERIC` 替换为：

```ts
const GENERIC: ModelProfile = {
  label: '通用',
  contextTokens: 131072,
  maxOutputTokens: 8192,
  openaiOutputParam: 'max_tokens',
  reasoning: false,
  vision: false
}
```

`PROFILES` 每一项在 `reasoning` 后补 `vision`（顺序与现有项一致）：

| 匹配 | vision |
| --- | --- |
| `^gpt-5` | `true` |
| `^o[1-9]` | `false` |
| `^gpt-4\.1` | `true` |
| `^gpt-4o` | `true` |
| `^gpt-4` | `false` |
| `^claude-opus-4` | `true` |
| `^claude-3[-.]7` | `true` |
| `^claude-3-opus` | `true` |
| `^claude-3` | `true` |
| `^claude` | `true` |
| `^gemini-1\.5|^gemini-2\.0` | `true` |
| `^gemini-3` | `true` |
| `^gemini` | `true` |
| `^deepseek` | `false` |
| `^kimi|^moonshot` | `false` |
| `^qwen` | `false` |
| `^glm|^z-ai` | `false` |
| `^grok` | `false` |

例如 `^gpt-4o` 一行改成：

```ts
  {
    test: /^gpt-4o/,
    profile: { label: 'GPT-4o', contextTokens: 131072, maxOutputTokens: 16384, openaiOutputParam: 'max_tokens', reasoning: false, vision: true }
  },
```

- [ ] **Step 5: `resolveModelSettings` 透传新字段**

```ts
export function resolveModelSettings(
  provider: { modelSettings?: Record<string, ModelSettings> },
  model: string
): ResolvedModelSettings {
  const profile = profileForModel(model)
  const configured = provider.modelSettings?.[model] ?? {}
  return {
    reasoning: configured.reasoning ?? 'off',
    reasoningSupport: configured.reasoningSupport,
    reasoningMap: configured.reasoningMap,
    contextTokens: positiveNumber(configured.contextTokens) ?? profile.contextTokens,
    maxOutputTokens: positiveNumber(configured.maxOutputTokens) ?? profile.maxOutputTokens
  }
}
```

- [ ] **Step 6: 运行，确认通过**

Run: `npx vitest run src/core/llm/__tests__/modelCatalog.test.ts`
Expected: PASS

- [ ] **Step 7: 全量类型检查**

Run: `npx tsc -b --pretty false`
Expected: exit 0

- [ ] **Step 8: 提交**

```bash
git add src/core/llm/modelCatalog.ts src/core/llm/types.ts src/core/llm/__tests__/modelCatalog.test.ts
git commit -m "feat(core): add vision profile field and pass capability overrides through"
```

---

### Task 4: `buildModelParams` 应用映射与支持开关（TDD）

**Files:**
- Modify: `src/core/llm/__tests__/modelParams.test.ts`
- Modify: `src/core/llm/modelParams.ts`

- [ ] **Step 1: 把测试文件的 `params` 助手替换为支持新字段的版本**

```ts
import type { ReasoningMap, ReasoningLevel } from '../../../shared/types'

const params = (
  patch: Partial<{
    reasoning: ReasoningLevel
    reasoningSupport: boolean
    reasoningMap: ReasoningMap
    contextTokens: number
    maxOutputTokens: number
  }> = {}
) => ({
  reasoning: 'off' as const,
  contextTokens: 131072,
  maxOutputTokens: 8192,
  ...patch
})
```

- [ ] **Step 2: 追加失败的测试**（加在 `describe('buildModelParams', ...)` 内）

```ts
  it('用户声明不支持拓展思考时，即使档案支持也不发推理参数', () => {
    expect(buildModelParams('openai', 'o3-mini', params({ reasoning: 'high', reasoningSupport: false }))).toEqual({
      max_completion_tokens: 8192
    })
    expect(buildModelParams('anthropic', 'claude-sonnet-4-5', params({ reasoning: 'high', reasoningSupport: false }))).toEqual({
      max_tokens: 8192
    })
  })

  it('用户声明支持拓展思考时，档案说不支持也照样发', () => {
    expect(buildModelParams('openai', 'deepseek-chat', params({ reasoning: 'high', reasoningSupport: true }))).toEqual({
      max_tokens: 8192,
      reasoning_effort: 'high'
    })
  })

  it('填了映射就用映射，且不再附加协议内置推理参数', () => {
    const map: ReasoningMap = { path: 'enable_thinking', values: { low: 'true', medium: 'true', high: 'true' } }
    expect(
      buildModelParams('openai', 'deepseek-chat', params({ reasoning: 'high', reasoningSupport: true, reasoningMap: map }))
    ).toEqual({ max_tokens: 8192, enable_thinking: true })
  })

  it('映射支持嵌套路径与数字值', () => {
    const map: ReasoningMap = { path: 'generationConfig.thinkingConfig.thinkingBudget', values: { high: '4096' } }
    expect(buildModelParams('gemini', 'gemini-2.5-pro', params({ reasoning: 'high', reasoningMap: map }))).toEqual({
      generationConfig: { maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 4096 } }
    })
  })

  it('映射缺当前等级时回落到内置形式', () => {
    const map: ReasoningMap = { path: 'enable_thinking', values: { high: 'true' } }
    expect(buildModelParams('openai', 'o3-mini', params({ reasoning: 'low', reasoningMap: map }))).toEqual({
      max_completion_tokens: 8192,
      reasoning_effort: 'low'
    })
  })

  it('关闭推理时：映射填了「关」就发该值，没填就完全不发', () => {
    const withOff: ReasoningMap = { path: 'enable_thinking', values: { off: 'false' } }
    expect(buildModelParams('openai', 'deepseek-chat', params({ reasoningSupport: true, reasoningMap: withOff }))).toEqual({
      max_tokens: 8192,
      enable_thinking: false
    })
    const withoutOff: ReasoningMap = { path: 'enable_thinking', values: { high: 'true' } }
    expect(buildModelParams('openai', 'deepseek-chat', params({ reasoningSupport: true, reasoningMap: withoutOff }))).toEqual({
      max_tokens: 8192
    })
  })

  it('用户明确关闭时不使用映射', () => {
    const map: ReasoningMap = { path: 'enable_thinking', values: { off: 'false', high: 'true' } }
    expect(buildModelParams('openai', 'deepseek-chat', params({ reasoning: 'high', reasoningSupport: false, reasoningMap: map }))).toEqual({
      max_tokens: 8192
    })
  })
```

- [ ] **Step 3: 运行，确认失败**

Run: `npx vitest run src/core/llm/__tests__/modelParams.test.ts`
Expected: FAIL —— 多个断言收到内置推理参数或缺少映射字段

- [ ] **Step 4: 重写 `buildModelParams`**

`src/core/llm/modelParams.ts` 的 import 段与函数替换为：

```ts
/** 把「模型档案 + 用户覆盖」翻译成各协议的请求体片段。 */
import type { Protocol, ReasoningLevel } from '../../shared/types'
import { profileForModel, type ResolvedModelSettings } from './modelCatalog'
import { parseReasoningValue, setByPath } from './reasoningMap'

const BUDGETS: Record<Exclude<ReasoningLevel, 'off'>, number> = { low: 2048, medium: 8192, high: 16384 }

/**
 * Anthropic 要求 max_tokens > budget_tokens ≥ 1024，因此预算以用户设定的输出上限为准。
 * off、或输出上限留不出 ≥1024 的预算空间时返回 0（调用方据此不发送推理参数）。
 */
export function reasoningBudget(level: ReasoningLevel, maxOutputTokens: number): number {
  if (level === 'off') return 0
  const room = maxOutputTokens - 1024
  if (room < 1024) return 0
  return Math.min(BUDGETS[level], room)
}

export function buildModelParams(protocol: Protocol, model: string, params: ResolvedModelSettings): Record<string, unknown> {
  const profile = profileForModel(model)
  // 用户明确表态优先；未表态时回落到档案
  const support = params.reasoningSupport ?? profile.reasoning

  // 映射优先：用户填了当前等级的值就用它，并跳过协议内置推理参数
  const mappedPath = support ? params.reasoningMap?.path?.trim() : undefined
  const mappedValue = mappedPath ? parseReasoningValue(params.reasoningMap?.values[params.reasoning]) : undefined
  const useMap = mappedPath !== undefined && mappedPath !== '' && mappedValue !== undefined

  const budget = support && !useMap && profile.reasoning ? reasoningBudget(params.reasoning, params.maxOutputTokens) : 0
  const reasoningOn = budget > 0

  const body: Record<string, unknown> =
    protocol === 'anthropic'
      ? { max_tokens: params.maxOutputTokens }
      : protocol === 'gemini'
        ? { generationConfig: { maxOutputTokens: params.maxOutputTokens } }
        : { [profile.openaiOutputParam]: params.maxOutputTokens }

  if (useMap) {
    setByPath(body, mappedPath, mappedValue)
  } else if (reasoningOn) {
    if (protocol === 'anthropic') {
      body.thinking = { type: 'enabled', budget_tokens: budget }
    } else if (protocol === 'gemini') {
      ;(body.generationConfig as Record<string, unknown>).thinkingConfig = { thinkingBudget: budget }
    } else {
      body.reasoning_effort = params.reasoning
    }
  }

  return body
}
```

- [ ] **Step 5: 运行，确认通过**

Run: `npx vitest run src/core/llm/__tests__/modelParams.test.ts`
Expected: PASS（原 8 例 + 新 7 例）

- [ ] **Step 6: 提交**

```bash
git add src/core/llm/modelParams.ts src/core/llm/__tests__/modelParams.test.ts
git commit -m "feat(core): apply per-model reasoning map and capability override"
```

---

### Task 5: 适配器级回归测试 + 变异验证

**Files:**
- Modify: `src/core/llm/__tests__/adapters.test.ts`

- [ ] **Step 1: 追加 OpenAI 兼容适配器测试**（放在 `describe('OpenAICompatibleAdapter', ...)` 内）

```ts
  it('自定义映射经适配器落到请求体，且不再附加内置推理参数', async () => {
    let capturedBody: Record<string, unknown> = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL, init?: RequestInit) => {
        capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return sseResponse(['data: [DONE]\n\n'])
      })
    )

    const adapter = new OpenAICompatibleAdapter('https://api.deepseek.com/v1')
    await adapter.stream(
      'deepseek-chat',
      {
        system: '',
        messages: [],
        tools: [],
        signal: undefined,
        params: {
          reasoning: 'high',
          reasoningSupport: true,
          reasoningMap: { path: 'enable_thinking', values: { high: 'true' } },
          contextTokens: 131072,
          maxOutputTokens: 8192
        }
      },
      'k',
      noopHandlers
    )

    expect(capturedBody.enable_thinking).toBe(true)
    expect(capturedBody.reasoning_effort).toBeUndefined()
  })
```

- [ ] **Step 2: 追加 Gemini 适配器测试**（放在 `describe('GeminiAdapter', ...)` 内）

```ts
  it('嵌套映射并入 generationConfig，不覆盖输出上限', async () => {
    let capturedBody: Record<string, unknown> = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL, init?: RequestInit) => {
        capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return sseResponse(['data: {"candidates":[{"content":{"parts":[{"text":"好"}]}}]}\n\n'])
      })
    )

    const adapter = new GeminiAdapter('https://generativelanguage.googleapis.com')
    await adapter.stream(
      'gemini-2.5-pro',
      {
        system: '',
        messages: [],
        tools: [],
        signal: undefined,
        params: {
          reasoning: 'high',
          reasoningMap: { path: 'generationConfig.thinkingConfig.thinkingBudget', values: { high: '4096' } },
          contextTokens: 1048576,
          maxOutputTokens: 8192
        }
      },
      'k',
      noopHandlers
    )

    expect(capturedBody.generationConfig).toEqual({ maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 4096 } })
  })
```

- [ ] **Step 3: 运行**

Run: `npx vitest run src/core/llm/__tests__/adapters.test.ts`
Expected: PASS（Task 4 已实现该行为；若 FAIL 则按报错修 `buildModelParams`，不要改测试）

- [ ] **Step 4: 变异验证（证明测试真的盯着这段逻辑）**

把 `src/core/llm/modelParams.ts` 中 `const useMap = ...` 临时改成：

```ts
  const useMap = false
```

Run: `npx vitest run src/core/llm/__tests__/adapters.test.ts -t "映射"`
Expected: FAIL（`enable_thinking` 缺失）

改回原样：

```ts
  const useMap = mappedPath !== undefined && mappedPath !== '' && mappedValue !== undefined
```

Run: `git diff --stat src/core/llm/modelParams.ts`
Expected: 无输出（已完全还原）

- [ ] **Step 4: 提交**

```bash
git add src/core/llm/__tests__/adapters.test.ts
git commit -m "test(core): cover reasoning map end-to-end in adapters"
```

---

### Task 6: 持久化往返（新字段）

**Files:**
- Modify: `src/main/services/__tests__/settingsService.test.ts`
- Modify: `src/server/__tests__/server.test.ts`

- [ ] **Step 1: 追加主进程往返测试**（加在 `describe('SettingsService 每模型参数', ...)` 内，沿用同文件 `withService` 写法）

```ts
  it('能力开关与思考强度映射能原样存回', async () => {
    await withService(async (service) => {
      await service.saveProvider({
        ...provider,
        modelSettings: {
          'gpt-4o': {
            reasoningSupport: true,
            vision: true,
            reasoning: 'high',
            reasoningMap: { path: 'enable_thinking', values: { high: 'true', off: 'false' } },
            contextTokens: 131072,
            maxOutputTokens: 8192
          }
        }
      })

      const publicSettings = service.toPublic(await service.load())
      expect(publicSettings.providers[0].modelSettings['gpt-4o']).toEqual({
        reasoningSupport: true,
        vision: true,
        reasoning: 'high',
        reasoningMap: { path: 'enable_thinking', values: { high: 'true', off: 'false' } },
        contextTokens: 131072,
        maxOutputTokens: 8192
      })
    })
  })
```

- [ ] **Step 2: 追加服务端 RPC 往返断言**

在 `src/server/__tests__/server.test.ts` 的「每模型参数要能经 RPC 保存并读回」片段里，把 `saveProvider` 请求体第 84 行改成：

```ts
              modelSettings: {
                'gpt-4o': {
                  reasoningSupport: true,
                  vision: true,
                  reasoning: 'medium',
                  reasoningMap: { path: 'thinking.type', values: { medium: 'enabled' } },
                  contextTokens: 131072,
                  maxOutputTokens: 8192
                },
                '已移除的模型': { reasoning: 'low' }
              }
```

并把第 91-93 行的读回断言改成：

```ts
      expect(settingsPayload.providers.find((provider) => provider.name === '网页供应商')?.modelSettings).toEqual({
        'gpt-4o': {
          reasoningSupport: true,
          vision: true,
          reasoning: 'medium',
          reasoningMap: { path: 'thinking.type', values: { medium: 'enabled' } },
          contextTokens: 131072,
          maxOutputTokens: 8192
        }
      })
```

- [ ] **Step 3: 运行**

Run: `npx vitest run src/main/services/__tests__/settingsService.test.ts src/server/__tests__/server.test.ts`
Expected: PASS（字段经展开式合并自动透传；若 FAIL，检查 `settingsService.toPublic` 与 `settingsStore` 是否有逐字段白名单）

- [ ] **Step 4: 提交**

```bash
git add src/main/services/__tests__/settingsService.test.ts src/server/__tests__/server.test.ts
git commit -m "test: round-trip model capability and reasoning map settings"
```

---

### Task 7: 渲染层纯逻辑（TDD）

**Files:**
- Create: `src/renderer/src/lib/__tests__/modelCapability.test.ts`
- Create: `src/renderer/src/lib/modelCapability.ts`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, expect, it } from 'vitest'
import {
  addModels,
  filterModels,
  isValidModelName,
  mappingWarning,
  pendingModels,
  removeModel,
  resolveCapability,
  setMappingPath,
  setMappingValue
} from '../modelCapability'

describe('resolveCapability', () => {
  it('用户声明优先，未表态时回落档案', () => {
    expect(resolveCapability('gpt-4o')).toEqual({ reasoning: false, vision: true })
    expect(resolveCapability('gpt-4o', { reasoningSupport: true, vision: false })).toEqual({ reasoning: true, vision: false })
    expect(resolveCapability('some-internal', { vision: true })).toEqual({ reasoning: false, vision: true })
  })
})

describe('模型清单', () => {
  it('添加时去空白、去重、保持顺序', () => {
    expect(addModels(['a'], [' b ', 'a', '', 'c'])).toEqual(['a', 'b', 'c'])
  })

  it('删除只移除目标', () => {
    expect(removeModel(['a', 'b', 'a'], 'a')).toEqual(['b'])
  })

  it('候选差集保持服务返回顺序且去重', () => {
    expect(pendingModels(['a'], ['c', 'a', 'b', 'c'])).toEqual(['c', 'b'])
  })

  it('搜索不区分大小写，空查询返回全部', () => {
    expect(filterModels(['GPT-4o', 'deepseek-chat'], 'gpt')).toEqual(['GPT-4o'])
    expect(filterModels(['a', 'b'], '  ')).toEqual(['a', 'b'])
  })

  it('模型名校验拒绝空、换行与超长', () => {
    expect(isValidModelName('gpt-5-internal')).toBe(true)
    expect(isValidModelName('   ')).toBe(false)
    expect(isValidModelName('a\nb')).toBe(false)
    expect(isValidModelName('x'.repeat(201))).toBe(false)
  })
})

describe('映射编辑', () => {
  it('写入路径时保留已有值', () => {
    expect(setMappingPath({ path: 'old', values: { low: '1' } }, 'new')).toEqual({ path: 'new', values: { low: '1' } })
  })

  it('写入值；空字符串表示删除该等级', () => {
    expect(setMappingValue(undefined, 'high', 'true')).toEqual({ path: '', values: { high: 'true' } })
    expect(setMappingValue({ path: 'p', values: { high: 'true' } }, 'high', '  ')).toEqual({ path: 'p', values: {} })
  })

  it('有值但没填参数名时给出提示', () => {
    expect(mappingWarning({ path: '', values: { high: 'true' } })).toBe('请先填写官方参数名')
    expect(mappingWarning({ path: 'a b', values: {} })).toBe('参数名里不能有空格')
    expect(mappingWarning({ path: 'enable_thinking', values: { high: 'true' } })).toBeNull()
    expect(mappingWarning(undefined)).toBeNull()
  })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run src/renderer/src/lib/__tests__/modelCapability.test.ts`
Expected: FAIL —— 无法解析模块 `../modelCapability`

- [ ] **Step 3: 最小实现**

```ts
/** 模型能力与模型清单的纯逻辑（UI 用，无副作用）。 */
import type { ModelSettings, ReasoningLevel, ReasoningMap } from '../../../shared/types'
import { profileForModel } from '../../../core/llm/modelCatalog'

/** 用户声明优先，缺省回落到内置档案。 */
export function resolveCapability(model: string, settings?: ModelSettings): { reasoning: boolean; vision: boolean } {
  const profile = profileForModel(model)
  return {
    reasoning: settings?.reasoningSupport ?? profile.reasoning,
    vision: settings?.vision ?? profile.vision
  }
}

/** 合并添加：去空白、去重、保持顺序。 */
export function addModels(current: string[], incoming: string[]): string[] {
  const out = [...current]
  const seen = new Set(current)
  for (const raw of incoming) {
    const name = raw.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

export function removeModel(current: string[], model: string): string[] {
  return current.filter((m) => m !== model)
}

/** 服务返回但尚未添加的模型：保持服务返回顺序并去重。 */
export function pendingModels(configured: string[], fetched: string[]): string[] {
  const have = new Set(configured)
  const seen = new Set<string>()
  return fetched.filter((m) => {
    if (have.has(m) || seen.has(m)) return false
    seen.add(m)
    return true
  })
}

export function filterModels(models: string[], query: string): string[] {
  const q = query.trim().toLowerCase()
  return q ? models.filter((m) => m.toLowerCase().includes(q)) : models
}

export function isValidModelName(name: string): boolean {
  const text = name.trim()
  return text.length > 0 && text.length <= 200 && !/[\r\n]/.test(text)
}

export function setMappingPath(map: ReasoningMap | undefined, path: string): ReasoningMap {
  return { path, values: { ...(map?.values ?? {}) } }
}

/** 写入某个等级的映射值；空白表示删除该等级。 */
export function setMappingValue(map: ReasoningMap | undefined, level: ReasoningLevel, value: string): ReasoningMap {
  const values = { ...(map?.values ?? {}) }
  if (value.trim()) values[level] = value
  else delete values[level]
  return { path: map?.path ?? '', values }
}

/** 返回提示文案；null 表示没有问题。 */
export function mappingWarning(map?: ReasoningMap): string | null {
  if (!map) return null
  const path = map.path.trim()
  const hasValue = Object.values(map.values).some((v) => Boolean(v && v.trim()))
  if (!path) return hasValue ? '请先填写官方参数名' : null
  if (/\s/.test(path)) return '参数名里不能有空格'
  return null
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `npx vitest run src/renderer/src/lib/__tests__/modelCapability.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/lib/modelCapability.ts src/renderer/src/lib/__tests__/modelCapability.test.ts
git commit -m "feat(renderer): add model capability and mapping pure helpers"
```

---

### Task 8: 模型管理整页 + 供应商小窗瘦身

**Files:**
- Create: `src/renderer/src/pages/settings/ModelManagerView.tsx`
- Modify: `src/renderer/src/pages/settings/SettingsPage.tsx`

- [ ] **Step 1: 新建整页组件**

```tsx
/** 模型管理整页：拉取、勾选添加、手动添加、搜索、逐模型展开面板。 */
import { ChevronDown, ChevronLeft, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge, Button, Card, Field, Input } from '../../components/ui/primitives'
import { api } from '../../lib/api'
import { PROTOCOL_LABEL } from '../../lib/utils'
import { CONTEXT_PRESETS, OUTPUT_PRESETS, formatTokens, modelParamOptions } from '../../lib/modelParamOptions'
import {
  addModels,
  filterModels,
  isValidModelName,
  mappingWarning,
  pendingModels,
  removeModel,
  resolveCapability,
  setMappingPath,
  setMappingValue
} from '../../lib/modelCapability'
import { profileForModel } from '../../../../core/llm/modelCatalog'
import type { ModelSettings, ProviderPublic, ReasoningLevel } from '../../../../shared/types'

const LEVELS: Array<{ value: ReasoningLevel; label: string }> = [
  { value: 'off', label: '关' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' }
]

interface Props {
  provider: ProviderPublic
  onClose: () => void
  onSaved: () => Promise<void>
}

export function ModelManagerView({ provider, onClose, onSaved }: Props): React.ReactElement {
  const [models, setModels] = useState<string[]>([...provider.models])
  const [modelSettings, setModelSettings] = useState<Record<string, ModelSettings>>({ ...provider.modelSettings })
  const [fetched, setFetched] = useState<string[] | null>(null)
  const [checked, setChecked] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [manual, setManual] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [fetching, setFetching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty = useMemo(
    () =>
      JSON.stringify({ models, modelSettings }) !==
      JSON.stringify({ models: provider.models, modelSettings: provider.modelSettings }),
    [models, modelSettings, provider]
  )

  const patch = (model: string, next: Partial<ModelSettings>): void => {
    setModelSettings((prev) => ({ ...prev, [model]: { ...prev[model], ...next } }))
  }

  const doFetch = async (): Promise<void> => {
    setFetching(true)
    setError(null)
    try {
      const list = await api.fetchModels({ providerId: provider.id, protocol: provider.protocol, baseUrl: provider.baseUrl })
      if (list.length === 0) setError('服务未返回任何模型，请检查 Base URL')
      setFetched(list)
      setChecked([])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setFetching(false)
    }
  }

  const addManual = (): void => {
    const name = manual.trim()
    if (!isValidModelName(name)) {
      setError('模型名不能为空、不能含换行，且不超过 200 字符')
      return
    }
    setModels((prev) => addModels(prev, [name]))
    setManual('')
    setError(null)
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      await api.saveProvider({
        id: provider.id,
        name: provider.name,
        protocol: provider.protocol,
        baseUrl: provider.baseUrl,
        models,
        modelSettings
      })
      await onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const back = (): void => {
    if (dirty && !window.confirm('有未保存的模型改动，放弃并返回？')) return
    onClose()
  }

  const pending = fetched ? pendingModels(models, fetched) : []
  const visible = filterModels(models, query)

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={back}>
          <ChevronLeft size={14} /> 返回
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">管理模型 · {provider.name}</h2>
        <Badge tone="accent">{PROTOCOL_LABEL[provider.protocol]}</Badge>
        <Button size="sm" variant="primary" onClick={() => void save()} loading={saving} disabled={!dirty}>
          保存
        </Button>
      </div>

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void doFetch()} loading={fetching}>
            <RefreshCw size={13} /> 从服务拉取
          </Button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addManual()
              }}
              placeholder="手动添加模型名，如 gpt-5-internal"
            />
            <Button size="sm" variant="soft" onClick={addManual}>
              <Plus size={13} /> 添加
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Search size={14} className="text-faint" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索" className="w-40" />
          </div>
        </div>
        {error && <div className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</div>}
      </Card>

      {fetched && (
        <Card className="space-y-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-muted">服务返回但未添加（{pending.length}）</h3>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setChecked(pending)} disabled={pending.length === 0}>
                全选
              </Button>
              <Button
                size="sm"
                variant="soft"
                onClick={() => {
                  setModels((prev) => addModels(prev, checked))
                  setChecked([])
                }}
                disabled={checked.length === 0}
              >
                添加选中（{checked.length}）
              </Button>
              <Button
                size="sm"
                variant="soft"
                onClick={() => {
                  setModels((prev) => addModels(prev, pending))
                  setChecked([])
                }}
                disabled={pending.length === 0}
              >
                全部添加
              </Button>
            </div>
          </div>
          {pending.length === 0 ? (
            <p className="text-xs text-faint">服务返回的模型都已添加</p>
          ) : (
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {pending.map((model) => (
                <label key={model} className="flex items-center gap-2 rounded-md bg-app px-2 py-1.5 text-xs">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                    checked={checked.includes(model)}
                    onChange={(e) =>
                      setChecked((prev) => (e.target.checked ? [...prev, model] : prev.filter((x) => x !== model)))
                    }
                  />
                  <span className="min-w-0 flex-1 truncate font-mono">{model}</span>
                </label>
              ))}
            </div>
          )}
        </Card>
      )}

      <Card className="space-y-1.5 p-4">
        <h3 className="text-xs font-semibold text-muted">已添加（{models.length}）</h3>
        {models.length === 0 && <p className="text-xs text-faint">还没有模型，先拉取或手动添加</p>}
        {visible.map((model) => {
          const profile = profileForModel(model)
          const current = modelSettings[model] ?? {}
          const capability = resolveCapability(model, current)
          const open = expanded === model
          const warning = mappingWarning(current.reasoningMap)
          return (
            <div key={model} className="rounded-md bg-app">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  onClick={() => setExpanded(open ? null : model)}
                >
                  <ChevronDown size={13} className={`shrink-0 text-faint transition-transform ${open ? '' : '-rotate-90'}`} />
                  <span className="min-w-0 truncate font-mono text-xs" title={model}>
                    {model}
                  </span>
                </button>
                {capability.reasoning && <Badge tone="accent">思考</Badge>}
                {capability.vision && <Badge tone="ok">图片</Badge>}
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger hover:text-danger"
                  onClick={() => {
                    setModels((prev) => removeModel(prev, model))
                    setModelSettings((prev) => {
                      const next = { ...prev }
                      delete next[model]
                      return next
                    })
                  }}
                >
                  <Trash2 size={13} />
                </Button>
              </div>

              {open && (
                <div className="space-y-3 border-t border-line/60 px-3 py-3">
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--accent)]"
                      checked={capability.reasoning}
                      onChange={(e) => patch(model, { reasoningSupport: e.target.checked })}
                    />
                    支持拓展思考
                  </label>

                  {capability.reasoning && (
                    <>
                      <Field label="思考强度">
                        <select
                          className="set-select"
                          value={current.reasoning ?? 'off'}
                          onChange={(e) => patch(model, { reasoning: e.target.value as ReasoningLevel })}
                        >
                          {LEVELS.map((level) => (
                            <option key={level.value} value={level.value}>
                              {level.label}
                            </option>
                          ))}
                        </select>
                      </Field>

                      <Field
                        label="官方思考强度映射"
                        hint="填了就以这里的参数为准（不再附加内置推理参数）；参数名用点号表示层级，值支持数字 / true / false / 字符串。Gemini 请以 generationConfig. 开头，Anthropic 可直接填 thinking 并写完整 JSON 对象。"
                      >
                        <div className="space-y-2">
                          <Input
                            value={current.reasoningMap?.path ?? ''}
                            onChange={(e) => patch(model, { reasoningMap: setMappingPath(current.reasoningMap, e.target.value) })}
                            placeholder="reasoning_effort / thinking.type / generationConfig.thinkingConfig.thinkingBudget"
                          />
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            {LEVELS.map((level) => (
                              <label key={level.value} className="space-y-1">
                                <span className="text-[11px] text-faint">{level.label}</span>
                                <Input
                                  value={current.reasoningMap?.values[level.value] ?? ''}
                                  onChange={(e) =>
                                    patch(model, { reasoningMap: setMappingValue(current.reasoningMap, level.value, e.target.value) })
                                  }
                                  placeholder={level.value === 'off' ? '留空=不发' : '留空=用内置'}
                                />
                              </label>
                            ))}
                          </div>
                          {warning && <p className="text-[11px] text-danger">{warning}</p>}
                        </div>
                      </Field>
                    </>
                  )}

                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--accent)]"
                      checked={capability.vision}
                      onChange={(e) => patch(model, { vision: e.target.checked })}
                    />
                    支持图片输入
                  </label>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Field label="上下文长度">
                      <select
                        className="set-select"
                        value={current.contextTokens ?? profile.contextTokens}
                        onChange={(e) => patch(model, { contextTokens: Number(e.target.value) })}
                      >
                        {modelParamOptions(CONTEXT_PRESETS, profile.contextTokens).map((value) => (
                          <option key={value} value={value}>
                            上下文 {formatTokens(value)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="输出上限">
                      <select
                        className="set-select"
                        value={current.maxOutputTokens ?? profile.maxOutputTokens}
                        onChange={(e) => patch(model, { maxOutputTokens: Number(e.target.value) })}
                      >
                        {modelParamOptions(OUTPUT_PRESETS, profile.maxOutputTokens).map((value) => (
                          <option key={value} value={value}>
                            输出 {formatTokens(value)}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: `SettingsPage` 接线**

1) import 调整（第 1、9、10、14 行）：

```tsx
import { KeyRound, Pencil, Plus, Settings2, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Badge, Button, Card, EmptyState, Field, Input, Spinner } from '../../components/ui/primitives'
import { Modal } from '../../components/ui/modal'
import { ModelManagerView } from './ModelManagerView'
import { api } from '../../lib/api'
import { PROTOCOL_LABEL } from '../../lib/utils'
import { isValidHexColor } from '../../lib/accent'
import { EDITOR_FONT_SIZES, EDITOR_LINE_HEIGHTS } from '../../lib/editorStyle'
import { createKeyedDebounce } from '../../lib/pendingCommit'
import { playCompletionSound } from '../../lib/completionSound'
import type { ChatDensity, EditorFontFamily, Protocol, ProviderInput, ProviderPublic, SendShortcut } from '../../../../shared/types'
import { useSettings } from '../../stores/settingsStore'
```

（`RefreshCw`、`profileForModel`、`modelParamOptions`、`CONTEXT_PRESETS`、`OUTPUT_PRESETS`、`formatTokens`、`ModelSettings`、`ReasoningLevel` 已不再使用，必须删除，否则 `noUnusedLocals` 为 false 虽不报错但会留下死代码。）

2) 状态与函数：删除 `fetchingModels` 状态与 `doFetchModels` 函数（第 50、83-101 行），新增：

```tsx
  const [managingId, setManagingId] = useState<string | null>(null)
```

3) 在 `if (!settings)` 之后、`openCreate` 之前插入：

```tsx
  const managing = managingId ? settings.providers.find((p) => p.id === managingId) ?? null : null
  if (managing) {
    return (
      <ModelManagerView
        provider={managing}
        onClose={() => setManagingId(null)}
        onSaved={reload}
      />
    )
  }
```

4) 供应商卡片按钮组（第 182-187 行附近）在编辑按钮前插入：

```tsx
                      <Button size="sm" variant="ghost" onClick={() => setManagingId(p.id)} title="管理模型">
                        <Settings2 size={13} />
                      </Button>
```

5) 小窗内删除三块：`模型列表（N 个）` 的 `Field`（含 textarea）、「从服务拉取模型列表」按钮、`{editing.models.length > 0 && (...)}` 的「模型参数」整块；替换为：

```tsx
            <Field label="模型" hint="模型列表与逐模型能力改到「管理模型」里设置（拉取、勾选、手动添加、思考强度映射）">
              <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-panel px-3 py-2 text-xs">
                <span className="text-muted">已配置 {editing.models.length} 个模型</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => (editingId ? setManagingId(editingId) : setFormError('请先保存供应商，再管理模型'))}
                >
                  <Settings2 size={13} /> 管理模型
                </Button>
              </div>
            </Field>
```

- [ ] **Step 3: 类型检查与构建**

Run: `npx tsc -b --pretty false`
Expected: exit 0

Run: `npm run build`
Expected: exit 0

- [ ] **Step 4: 提交**

```bash
git add src/renderer/src/pages/settings/ModelManagerView.tsx src/renderer/src/pages/settings/SettingsPage.tsx
git commit -m "feat(renderer): add model manager page and slim provider modal"
```

---

### Task 9: 聊天窗口能力标记

**Files:**
- Modify: `src/renderer/src/pages/chat/ChatPage.tsx:266-272`

- [ ] **Step 1: 在 `ChatPage` 顶部 import 里加纯函数**

```tsx
import { resolveCapability } from '../../lib/modelCapability'
```

- [ ] **Step 2: 模型下拉的 `<option>` 文案加能力后缀**

```tsx
              {providerOptions.map((p) => (
                <optgroup key={p.id} label={p.name}>
                  {p.models.map((m) => {
                    const capability = resolveCapability(m, p.modelSettings[m])
                    const suffix = [capability.reasoning ? '思考' : '', capability.vision ? '图片' : ''].filter(Boolean).join(' · ')
                    return (
                      <option key={m} value={`${p.id}::${m}`}>
                        {m}
                        {suffix ? ` · ${suffix}` : ''}
                      </option>
                    )
                  })}
                </optgroup>
              ))}
```

（保持外层 `<select>`、`value`、`onChange` 与 `<optgroup>` 结构不变，只替换内部 `p.models.map(...)` 的返回值。）

- [ ] **Step 3: 类型检查**

Run: `npx tsc -b --pretty false`
Expected: exit 0

- [ ] **Step 4: 提交**

```bash
git add src/renderer/src/pages/chat/ChatPage.tsx
git commit -m "feat(renderer): show model capability in chat model picker"
```

---

### Task 10: 全量验证与打包

**Files:** 无代码改动

- [ ] **Step 1: 全量测试**

Run: `npm test -- --run`
Expected: 全部通过（原 44 文件 218 例 + 新增约 25 例）

- [ ] **Step 2: 类型检查与三端构建**

Run: `npx tsc -b --pretty false`
Expected: exit 0

Run: `npm run build`
Expected: exit 0

Run: `npm run server:build:all`
Expected: exit 0

- [ ] **Step 3: 打包（需先关闭正在运行的应用）**

先确认应用已退出：`Get-Process -Name StoryFabric -ErrorAction SilentlyContinue`
若仍在运行，请用户关闭后再继续。

Run: `npm run dist:win`
Expected: exit 0，生成 `release\win-unpacked\StoryFabric.exe` 与 `release\StoryFabric Setup 0.1.0.exe`

- [ ] **Step 4: 产物核验**

```powershell
node -e "const fs=require('fs');const b=fs.readFileSync('release/win-unpacked/resources/app.asar');for(const s of ['reasoningMap','reasoningSupport','enable_thinking','管理模型','官方思考强度映射','支持图片输入']) console.log(s, b.includes(Buffer.from(s)));"
```

Expected: 全部 `true`

- [ ] **Step 5: 手工走查（应用内）**

1. 设置 → 模型与供应商 → 某个供应商卡片上的「管理模型」→ 进入整页。
2. 点「从服务拉取」→ 出现「服务返回但未添加」→ 勾选两个 → 「添加选中」→ 已添加列表出现它们。
3. 手动输入一个不存在的模型名 → 添加成功；再输一次同名 → 不重复。
4. 展开一个模型 → 打开「支持拓展思考」→ 出现强度下拉与映射编辑器 → 填 `enable_thinking` / 高=`true` → 保存。
5. 删除一个模型 → 保存 → 重新打开该供应商，被删模型与其设置都不在。
6. 工作台聊天页模型下拉 → 对应模型带「思考」后缀。
7. （有可用密钥时）用填了映射的模型发一条消息 → 请求成功（映射正确性由 Task 4/5 的单测与适配器测试保证）。

- [ ] **Step 6: 提交（若走查中有微调）**

```bash
git add -A -- src docs
git commit -m "fix(renderer): address model manager walkthrough findings"
```

---

### Task 11: 独立质量审查与修复

**Files:** 视审查结论而定

- [ ] **Step 1: 派独立只读审查子代理**

审查范围：`git diff <起点>..HEAD` 涉及的全部文件，重点：

1. `buildModelParams` 的优先级：用户关闭 > 映射 > 内置 > 无；`off` 有值/无值两种语义。
2. `setByPath` 的边界（空段、覆盖已有对象、数组）。
3. 三端持久化是否真的透传（而不是被某个白名单吞掉）。
4. `ModelManagerView` 的脏值判断、返回确认、保存时是否误传/丢失 API Key。
5. 删除模型是否连带清理 `modelSettings`。
6. 是否引入了档案级默认值被锁死的行为（不得再出现 `disabled={!profile.reasoning}` 这类硬锁）。

要求：只读、不得运行 build/dist、给出可复现的失败场景或明确的 PASS 结论。

- [ ] **Step 2: 逐条验证审查结论并修复**

对每条发现先自己复现（测试或代码阅读），确认为真再修；修复后重跑对应测试。

- [ ] **Step 3: 复审**

把修复后的 diff 再交同一个审查者复审，直到 PASS。

- [ ] **Step 4: 提交修复**

```bash
git add -A -- src
git commit -m "fix: address review findings for model capability management"
```

---

### Task 12: 文档与收尾

**Files:**
- Modify: `docs/superpowers/backlog.md`
- Create: `docs/superpowers/checkpoints/2026-09-09-model-capability-management.md`

- [ ] **Step 1: 更新 backlog**

在「新功能」章节下新增一节：

```markdown
### 4. 模型能力管理与思考强度映射（2026-09-09）

- [x] 模型管理独立整页：拉取移出供应商小窗、勾选添加/删除、手动添加（内测模型）、搜索。
- [x] 逐模型展开面板：支持拓展思考（用户决定，不锁死）、思考强度、支持图片输入、上下文/输出。
- [x] 官方思考强度 → 本地等级映射（用户自填，点路径 + 各等级值），智能体发请求时生效。
- [x] 设计：`specs/2026-09-09-model-capability-management-design.md`；计划：`plans/2026-09-09-model-capability-management.md`。
- [ ] 图片输入本身未实现（仅记录能力标记），落地时复用本开关。
```

- [ ] **Step 2: 写 checkpoint**

先取本次改动的提交号与验证数字：

```bash
git log --oneline -12
npm test -- --run 2>&1 | Select-String -Pattern 'Test Files|Tests '
```

再创建 `docs/superpowers/checkpoints/2026-09-09-model-capability-management.md`，按下面的骨架把尖括号处替换成上面命令的真实输出（不许留 `<...>`）：

```markdown
---
status: completed
branch: main
timestamp: 2026-09-09T<HH:mm>:00+08:00
files_modified:
  - src/shared/types.ts
  - src/core/llm/types.ts
  - src/core/llm/modelCatalog.ts
  - src/core/llm/modelParams.ts
  - src/core/llm/reasoningMap.ts
  - src/renderer/src/lib/modelCapability.ts
  - src/renderer/src/pages/settings/ModelManagerView.tsx
  - src/renderer/src/pages/settings/SettingsPage.tsx
  - src/renderer/src/pages/chat/ChatPage.tsx
---

## Completed: 模型能力管理与思考强度映射

### Summary

- 供应商小窗瘦身：只留名称/协议/Base URL/API Key + 「管理模型」入口。
- 新增整页 `ModelManagerView`：拉取、勾选添加、手动添加、搜索、逐模型展开面板。
- `ModelSettings` 新增 `reasoningSupport` / `vision` / `reasoningMap`，三端持久化 + RPC 往返。
- `buildModelParams` 优先级：用户明确关闭 > 用户映射 > 协议内置 > 不发；`off` 有值才发。
- 聊天窗口模型下拉显示「思考 / 图片」能力后缀。
- 提交：<Task 1..12 的提交号列表>

### Verification Evidence

- `npm test -- --run`：<Test Files 输出> / <Tests 输出>
- `npx tsc -b --pretty false`：exit 0
- `npm run build` / `npm run dist:win` / `npm run server:build:all`：exit 0
- asar 核验：reasoningMap / reasoningSupport / enable_thinking / 管理模型 / 官方思考强度映射 / 支持图片输入 —— <全部 true 的实际输出>
- 变异验证：`useMap = false` 时适配器映射测试失败，还原后无 diff
- 手工走查：<实际走到的步骤与结果>

### Notes and Risks

- 档案 `vision` / `reasoning` 只是默认值，用户可覆盖且不锁死。
- 映射是单一参数路径；Anthropic 需填 `thinking` 整对象，Gemini 需 `generationConfig.` 前缀。
- 图片开关目前只做记录与展示，图片输入本身未实现。
- 独立审查结论：<PASS 或修复项列表>
```

- [ ] **Step 3: 提交文档**

```bash
git add -f docs/superpowers/backlog.md docs/superpowers/checkpoints/2026-09-09-model-capability-management.md
git commit -m "docs(superpowers): record model capability management delivery"
```

---

## 验收对照

| Spec 要求 | 实现任务 |
| --- | --- |
| 拉取移出小窗、整页管理 | Task 8 |
| 勾选添加/删除、手动添加 | Task 7（纯逻辑）+ Task 8（UI） |
| 逐模型展开：思考开关（不锁死）、强度下拉、图片开关、上下文/输出 | Task 3（默认值）+ Task 7（解析）+ Task 8（UI） |
| 官方强度映射用户自填、发请求生效 | Task 1（类型）+ Task 2（解析/写入）+ Task 4（组装）+ Task 5（适配器级） |
| 三端持久化与 RPC 往返 | Task 6 |
| 聊天窗口能力标记 | Task 9 |
| 全量验证与打包 | Task 10 |
| 质量审查 | Task 11 |
