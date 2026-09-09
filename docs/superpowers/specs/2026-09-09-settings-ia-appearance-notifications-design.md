# 设置信息架构与外观/通知设置设计

**日期：** 2026-09-09
**状态：** 已确认，待实现

## 背景

当前 `src/renderer/src/pages/settings/SettingsPage.tsx` 是单列滚动，四个 `<section>`（供应商 / 智能体 / 默认模型 / 外观）没有分类导航；外观只有浅/深/跟随系统，无法自定义强调色；智能体生成结束时没有任何提示。

## 目标

1. 设置页按类别分组，顶部提供横向选择栏（tab）切换。
2. 新增「对话完成提示音」开关。
3. 新增「自定义主题色」，深浅主题分别保存。

## 非目标

- 不做字号/行距、编辑器字体、快捷键等其它外观项（记在 backlog）。
- 不做系统主题实时监听（跟随系统只在加载/更新设置时判定）。
- 不改供应商编辑、模型拉取等既有逻辑。

## 设计

### 数据层

`AppSettings`（`src/shared/types.ts`）新增：

| 字段 | 类型 | 默认值 |
| --- | --- | --- |
| `completionSound` | `boolean` | `false` |
| `accentColorLight` | `string`（`#rrggbb`） | `#6366f1` |
| `accentColorDark` | `string`（`#rrggbb`） | `#818cf8` |

`PublicAppSettings` 继承 `AppSettings`，`settingsService.toPublic` 与 `update` 分别展开/合并，故无需逐字段处理。需要显式补齐的地方：

- `src/shared/api.ts`：`SettingsPatch` 的 `Pick<...>` 列表。
- `src/main/services/settingsService.ts`：`DEFAULT_SETTINGS`。
- `src/server/settingsStore.ts`：默认值。
- `src/renderer/src/platform/androidApi.ts`：`DEFAULT_PUBLIC`。

### 主题色

新增纯函数 `src/renderer/src/lib/accent.ts`：

```ts
export interface AccentTokens { accent: string; strong: string; soft: string; fg: string }
export function isValidHexColor(value: string): boolean
export function accentTokens(hex: string, dark: boolean): AccentTokens
export function accentStyle(settings: { accentColorLight?: string; accentColorDark?: string }, dark: boolean): Record<string, string>
```

- `accentTokens`：由基色经 HSL 推导 `strong`（亮度 −0.08；基色亮度 < 0.12 时改为 +0.12，保证与 `accent` 可区分）、`soft`（低饱和底衬：饱和度 ×0.35，浅色主题 l=0.95、深色主题 l=0.16）、`fg`（在 `#ffffff` 与 `#18181b` 中取**对比度更高**者，而非亮度阈值——阈值写法会让默认深色基色 `#818cf8` 拿到白字，对比度仅 2.98:1）；非法输入回退到该模式的默认基色。
- `accentStyle`：按 `dark` 选择对应基色。**默认基色或非法值返回空对象**，不写内联变量，交由 `styles/index.css` 的手工配色，保证未自定义时默认外观不变。
- `settingsStore` 在 `load` / `update` 后先 `applyTheme` 再应用 `accentStyle`：有值则 `setProperty`，无值则 `removeProperty`（避免残留上一次的自定义值）。取色器拖动时只走 `previewAccent`（改 CSS 变量），停手 400ms 后才落盘。

### 设置页分类

`SettingsPage.tsx` 改为「顶部 tab + 内容区」：

| tab | 内容 |
| --- | --- |
| 模型与供应商 | 供应商列表 + 默认模型 |
| 智能体 | 自定义提示词 + 显示会话长度 |
| 外观 | 主题 + 主题色（取色器 + 预设 + 重置） |
| 通知 | 完成提示音开关 + 试听 |

tab 状态写入 `?tab=`（`useSearchParams`），刷新与深链保持；移动端 tab 横向滚动。

### 对话完成提示音

新增 `src/renderer/src/lib/completionSound.ts`：

```ts
export function shouldPlayCompletionSound(input: { enabled: boolean; error: boolean }): boolean
export function createCompletionSound(createContext?: () => AudioContextLike | null): { play: () => void; dispose: () => void }
export function playCompletionSound(): void
```

- WebAudio 合成两音（A5 880 Hz → D6 1174.66 Hz），各带 0.0001 → 0.15 → 0.0001 的增益包络，**不打包音频资源**；播放前若上下文 `state === 'suspended'` 先 `resume()`（浏览器自动播放策略可能挂起上下文）。
- `createCompletionSound` 接受可注入的 `AudioContext` 工厂，便于单测；默认实例懒建、异常静默。
- 触发点：`chatStore` 的 `case 'done'`，条件为「开关打开 且 本次运行没有 error」（用户中止会经 error 路径，因此同样不响）。

## 测试

- `src/renderer/src/lib/__tests__/accent.test.ts`：hex 校验（含非法/短串/无 `#`）、亮暗两套推导的通道和关系、`fg` 取值、`accentStyle` 的深浅选择与默认回退。
- `src/renderer/src/lib/__tests__/completionSound.test.ts`：`shouldPlayCompletionSound` 真值表；假 `AudioContext` 断言两次振荡器、频率、增益包络、时间递增、`dispose` 关闭。
- 设置页 tab 与控件靠 `tsc` + `npm run build` + 重新打包启动人工确认（仓库无 React 组件测试设施）。

## 风险

- 新增设置字段只写入 `settings.json`，旧文件缺字段时由 `loadRaw` 与各默认值兜底；需确认 `loadRaw` 会合并默认值。
- 自定义主题色只覆盖 `--accent*` 四个变量，危险色（`--danger`）、成功色（`--ok`）不受影响。
- 提示音依赖浏览器自动播放策略：Electron 无限制；Web 端首次播放需用户交互，失败静默不报错。
