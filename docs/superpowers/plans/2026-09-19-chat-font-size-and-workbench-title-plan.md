# 会话字号偏好与工作台标题层级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 去掉聊天页重复的“智能体工作台”标题，并增加只作用于聊天会话区域的可持久化字号偏好。

**Architecture:** 沿用现有 AppSettings → SettingsPatch → SettingsService → renderer settingsStore 的设置链路。新增一个小型 chatTypography 样式映射层，将会话字号转换为 CSS 变量；完整聊天页和小窗口聊天都通过 chat-surface 作用域消费这些变量。聊天页身份文字只保留 AppLayout 顶层标题，ChatPage 顶栏提取为无重复文字的身份组件。

**Tech Stack:** TypeScript, React 19, Zustand, Tailwind CSS 4, Electron IPC, Vitest, electron-vite。

---

## 文件地图

- Modify: src/shared/types.ts — 给应用设置增加 chatFontSize 类型字段。
- Modify: src/shared/api.ts — 允许 IPC 设置补丁更新 chatFontSize。
- Modify: src/main/services/settingsService.ts — 默认值、旧设置兼容和字号范围规范化。
- Modify: src/main/services/__tests__/settingsService.test.ts — 覆盖默认、旧配置和非法值。
- Create: src/renderer/src/lib/chatTypography.ts — 将设置转换为会话 CSS 变量。
- Create: src/renderer/src/lib/__tests__/chatTypography.test.ts — 测试字号映射和范围夹紧。
- Modify: src/renderer/src/stores/settingsStore.ts — 应用和更新 --chat-font-* 变量。
- Modify: src/renderer/src/pages/settings/SettingsPage.tsx — 添加“会话窗口字号”设置项。
- Create: src/renderer/src/components/chat/ChatWorkbenchIdentity.tsx — 保留图标与会话统计，但不渲染重复工作台标题。
- Create: src/renderer/src/components/chat/__tests__/ChatWorkbenchIdentity.test.tsx — 回归测试身份组件不产生重复标题。
- Modify: src/renderer/src/pages/chat/ChatPage.tsx — 使用身份组件、挂载 chat-surface 并标记聊天正文/元信息。
- Modify: src/renderer/src/components/chat/ChatSidebar.tsx — 小窗口挂载同一 chat-surface 和字号语义类。
- Modify: src/renderer/src/components/chat/AgentActivity.tsx — 活动和工具回执使用会话字号语义类。
- Modify: src/renderer/src/components/chat/OrchestrationPanel.tsx — 编排状态和阶段信息使用会话字号语义类。
- Modify: src/renderer/src/components/chat/OrchestrationResults.tsx — 编排结果和工具读取回执使用会话字号语义类。
- Modify: src/renderer/src/components/chat/RunTimeline.tsx — 运行时间线文字使用会话字号语义类。
- Modify: src/renderer/src/styles/index.css — 定义 chat-surface 的继承和正文/元信息/微型文本变量消费规则。
- Modify: package.json — 版本更新为 0.1.8-snapshot。
- Modify: package-lock.json — 与 package 版本保持一致。

## Task 1: 先写设置规范化和样式映射的失败测试

Files:
- Modify: src/main/services/__tests__/settingsService.test.ts
- Create: src/renderer/src/lib/__tests__/chatTypography.test.ts

- [ ] Step 1: 在设置服务测试中增加兼容和非法值用例

在现有 settingsService.test.ts 的旧设置测试附近增加以下测试，验证设置边界负责回退：

    it('旧设置文件缺少 chatFontSize 时使用 14px', async () => {
      await withService(async (service, file) => {
        await writeFile(file, JSON.stringify({ providers: [], theme: 'system', recentWorkspaces: [] }), 'utf-8')
        expect((await service.load()).chatFontSize).toBe(14)
      })
    })

    it.each([
      ['过小', 1, 13],
      ['过大', 99, 20],
      ['非数字', '18', 14],
      ['空值', null, 14]
    ])('chatFontSize %s 时回退或夹紧为 %s', async (_label, value, expected) => {
      await withService(async (service, file) => {
        await writeFile(file, JSON.stringify({ chatFontSize: value }), 'utf-8')
        expect((await service.load()).chatFontSize).toBe(expected)
      })
    })

- [ ] Step 2: 新建样式映射测试

创建 src/renderer/src/lib/__tests__/chatTypography.test.ts：

    import { describe, expect, it } from 'vitest'
    import { chatTypographyStyle } from '../chatTypography'

    describe('chatTypographyStyle', () => {
      it('缺省时保持当前 14px 会话观感', () => {
        expect(chatTypographyStyle({})['--chat-font-size']).toBe('14px')
      })

      it('把字号设置映射为会话变量', () => {
        const style = chatTypographyStyle({ chatFontSize: 18 })
        expect(style['--chat-font-size']).toBe('18px')
        expect(style['--chat-font-meta-size']).toBe('16px')
        expect(style['--chat-font-micro-size']).toBe('14px')
      })

      it('对非法和越界值执行同一范围约束', () => {
        expect(chatTypographyStyle({ chatFontSize: 1 })['--chat-font-size']).toBe('13px')
        expect(chatTypographyStyle({ chatFontSize: 99 })['--chat-font-size']).toBe('20px')
        expect(chatTypographyStyle({ chatFontSize: Number.NaN })['--chat-font-size']).toBe('14px')
      })
    })

- [ ] Step 3: 运行新增测试，确认它们先失败

Run:

    npm test -- src/main/services/__tests__/settingsService.test.ts src/renderer/src/lib/__tests__/chatTypography.test.ts

Expected: FAIL，因为 chatFontSize、chatTypographyStyle 和 chatTypography.ts 尚未存在。

## Task 2: 接通应用设置和 CSS 变量

Files:
- Modify: src/shared/types.ts:199-235
- Modify: src/shared/api.ts:48-66
- Modify: src/main/services/settingsService.ts:42-112
- Create: src/renderer/src/lib/chatTypography.ts
- Modify: src/renderer/src/stores/settingsStore.ts:35-47
- Modify: src/main/services/__tests__/settingsService.test.ts

- [ ] Step 1: 增加共享设置字段和 IPC patch 字段

在 AppSettings 的 chatDensity 后增加：

    /** 会话窗口字号（px），只作用于聊天区域 */
    chatFontSize: number

并在 SettingsPatch 的 Pick<PublicAppSettings, ...> 联合中加入 chatFontSize。

- [ ] Step 2: 增加默认值与规范化函数

在 settingsService.ts 中加入：

    const DEFAULT_CHAT_FONT_SIZE = 14

    function normalizeChatFontSize(value: unknown): number {
      if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_CHAT_FONT_SIZE
      return Math.round(Math.min(20, Math.max(13, value)))
    }

在 DEFAULT_SETTINGS 中加入 chatFontSize: DEFAULT_CHAT_FONT_SIZE，在 normalizeSettings 返回对象中显式覆盖：

    chatFontSize: normalizeChatFontSize(parsed.chatFontSize)

这样旧 JSON 即使缺字段或字段类型错误，也会收到稳定的数字值。

- [ ] Step 3: 创建会话字号样式映射

创建 src/renderer/src/lib/chatTypography.ts：

    export interface ChatTypographySettings {
      chatFontSize?: number
    }

    export const CHAT_FONT_SIZES = [13, 14, 16, 18, 20] as const

    function clamp(value: number, min: number, max: number): number {
      if (!Number.isFinite(value)) return 14
      return Math.round(Math.min(max, Math.max(min, value)))
    }

    export function chatTypographyStyle(settings: ChatTypographySettings): Record<string, string> {
      const size = clamp(settings.chatFontSize ?? 14, 13, 20)
      return {
        '--chat-font-size': size + 'px',
        '--chat-font-meta-size': Math.max(11, size - 2) + 'px',
        '--chat-font-micro-size': Math.max(9, size - 4) + 'px'
      }
    }

- [ ] Step 4: 让 settingsStore 应用变量

在 settingsStore.ts 导入 chatTypographyStyle，新增：

    const CHAT_TYPOGRAPHY_VARS = ['--chat-font-size', '--chat-font-meta-size', '--chat-font-micro-size']

    function applyChatTypography(settings: PublicAppSettings | null): void {
      const style = chatTypographyStyle(settings ?? {})
      for (const key of CHAT_TYPOGRAPHY_VARS) document.documentElement.style.setProperty(key, style[key])
    }

在 applyAppearance 中于 applyEditor(settings) 后调用 applyChatTypography(settings)，保证首次加载和设置更新都立即反映到页面。

- [ ] Step 5: 运行设置与样式测试，确认通过

Run:

    npm test -- src/main/services/__tests__/settingsService.test.ts src/renderer/src/lib/__tests__/chatTypography.test.ts

Expected: PASS，且旧设置文件缺失 chatFontSize 时回落为 14。

- [ ] Step 6: Commit 设置链路

    git add -- src/shared/types.ts src/shared/api.ts src/main/services/settingsService.ts src/main/services/__tests__/settingsService.test.ts src/renderer/src/lib/chatTypography.ts src/renderer/src/lib/__tests__/chatTypography.test.ts src/renderer/src/stores/settingsStore.ts
    git commit -m "feat: add persisted chat font size preference"

## Task 3: 在设置页提供会话字号偏好

Files:
- Modify: src/renderer/src/pages/settings/SettingsPage.tsx:1-15,397-414

- [ ] Step 1: 引入字号选项常量

把 CHAT_FONT_SIZES 加入 ../../lib/chatTypography 导入，并保留现有 ChatDensity、SendShortcut 类型导入。

- [ ] Step 2: 在聊天设置卡片增加字段

在“消息气泡密度”和“发送快捷键”之间加入：

    <Field label="会话窗口字号" hint="只影响聊天消息、输入框、工具回执、编排信息和智能体活动信息">
      <select
        value={settings.chatFontSize}
        onChange={(e) => void update({ chatFontSize: Number(e.target.value) })}
        className="set-select max-w-32"
      >
        {CHAT_FONT_SIZES.map((size) => (
          <option key={size} value={size}>{size}px</option>
        ))}
      </select>
    </Field>

- [ ] Step 3: 运行类型检查和相关测试

Run:

    npm run build
    npm test -- src/main/services/__tests__/settingsService.test.ts src/renderer/src/lib/__tests__/chatTypography.test.ts

Expected: build succeeds and the focused tests remain PASS.

- [ ] Step 4: Commit 设置页面

    git add -- src/renderer/src/pages/settings/SettingsPage.tsx
    git commit -m "feat: expose chat font size in settings"

## Task 4: 去除重复标题并补齐会话区域字号语义

Files:
- Create: src/renderer/src/components/chat/ChatWorkbenchIdentity.tsx
- Create: src/renderer/src/components/chat/__tests__/ChatWorkbenchIdentity.test.tsx
- Modify: src/renderer/src/pages/chat/ChatPage.tsx:229-245,350-410,560-575
- Modify: src/renderer/src/components/chat/ChatSidebar.tsx:30,280-480
- Modify: src/renderer/src/components/chat/AgentActivity.tsx
- Modify: src/renderer/src/components/chat/OrchestrationPanel.tsx
- Modify: src/renderer/src/components/chat/OrchestrationResults.tsx
- Modify: src/renderer/src/components/chat/RunTimeline.tsx
- Modify: src/renderer/src/styles/index.css

- [ ] Step 1: 提取不带重复文字的身份组件

创建 ChatWorkbenchIdentity.tsx，组件只渲染图标和可选会话统计，不渲染“智能体工作台”：

    import { Sparkles } from 'lucide-react'

    export function ChatWorkbenchIdentity({ showSessionLength, messageCount, totalChars }: {
      showSessionLength: boolean
      messageCount: number
      totalChars: number
    }): React.ReactElement {
      return (
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg shadow-sm">
            <Sparkles size={15} />
          </span>
          {showSessionLength && messageCount > 0 && (
            <span className="chat-text-meta shrink-0 whitespace-nowrap rounded-md bg-elevated px-2 py-0.5 text-muted">
              {messageCount} 条 · 约{totalChars > 1000 ? (totalChars / 1000).toFixed(1) + 'k' : totalChars} 字
            </span>
          )}
        </div>
      )
    }

在 ChatPage 顶栏用此组件替换原先含有智能体工作台的身份 JSX；AppLayout 的 TITLE_MAP.chat 保持不变，因此整个页面仍有一个顶层标题。

- [ ] Step 2: 编写标题去重回归测试

创建 ChatWorkbenchIdentity.test.tsx：

    import { renderToStaticMarkup } from 'react-dom/server'
    import { describe, expect, it } from 'vitest'
    import { ChatWorkbenchIdentity } from '../ChatWorkbenchIdentity'

    describe('ChatWorkbenchIdentity', () => {
      it('只显示身份图标和统计，不重复显示工作台标题', () => {
        const html = renderToStaticMarkup(<ChatWorkbenchIdentity showSessionLength messageCount={2} totalChars={1200} />)
        expect(html).not.toContain('智能体工作台')
        expect(html).toContain('2 条')
      })
    })

- [ ] Step 3: 给完整聊天页和小窗口挂载会话作用域

将 ChatPage 根节点和 ChatSidebar 外层容器分别加入 chat-surface，使同一组 CSS 变量覆盖完整聊天页和小窗口。不要把变量写到 body，以避免影响编辑器和其他页面。

- [ ] Step 4: 替换关键固定字号为语义类

把聊天区域内的正文、输入框、Markdown 容器使用 chat-text-body；阶段、工具回执、编排状态和运行时间线使用 chat-text-meta；参数预览、时间和辅助说明使用 chat-text-micro。保留 chatDensityClasses 对 padding 与列表间距的控制，不把字号设置混入密度逻辑。

示例：

    <textarea className="chat-text-body w-full resize-none bg-transparent px-3.5 py-3 pr-14 outline-none placeholder:text-faint" />
    <div className="chat-text-meta rounded-lg border border-line bg-panel px-3 py-2">阶段：{item.stageId}</div>
    <p className="chat-text-micro truncate font-mono text-faint">{toolArgsPreview}</p>

- [ ] Step 5: 增加 CSS 变量消费规则

在 index.css 的聊天样式区域加入：

    .chat-surface {
      font-size: var(--chat-font-size, 14px);
    }

    .chat-surface .chat-text-body {
      font-size: var(--chat-font-size, 14px);
    }

    .chat-surface .chat-text-meta {
      font-size: var(--chat-font-meta-size, 12px);
    }

    .chat-surface .chat-text-micro {
      font-size: var(--chat-font-micro-size, 10px);
    }

CSS 变量仅通过 .chat-surface 和语义类消费，不改变全局 body、CodeMirror 编辑器或设置页。

- [ ] Step 6: 运行渲染相关回归测试

Run:

    npm test -- src/renderer/src/components/chat/__tests__/ChatWorkbenchIdentity.test.tsx src/renderer/src/lib/__tests__/chatTypography.test.ts src/renderer/src/lib/__tests__/layoutPresentation.test.ts

Expected: PASS；输出中不应出现重复标题组件测试失败。

- [ ] Step 7: Commit 聊天 UI

    git add -- src/renderer/src/components/chat/ChatWorkbenchIdentity.tsx src/renderer/src/components/chat/__tests__/ChatWorkbenchIdentity.test.tsx src/renderer/src/pages/chat/ChatPage.tsx src/renderer/src/components/chat/ChatSidebar.tsx src/renderer/src/components/chat/AgentActivity.tsx src/renderer/src/components/chat/OrchestrationPanel.tsx src/renderer/src/components/chat/OrchestrationResults.tsx src/renderer/src/components/chat/RunTimeline.tsx src/renderer/src/styles/index.css
    git commit -m "feat: scope chat typography and remove duplicate title"

## Task 5: 更新快照版本并完成全量验证

Files:
- Modify: package.json:3
- Modify: package-lock.json:3,9

- [ ] Step 1: 更新版本号

将 package.json 与 package-lock.json 中的项目版本从 0.1.7-snapshot 更新为 0.1.8-snapshot；只修改项目自身版本字段，不改依赖版本。

- [ ] Step 2: 运行完整测试

Run:

    npm test

Expected: 全部既有测试和新增测试通过；若有失败，先定位是本次字号/标题改动还是工作树既有改动造成的，再继续，不以跳过测试代替修复。

- [ ] Step 3: 运行生产构建

Run:

    npm run build

Expected: main、preload、renderer 构建成功，无 TypeScript 或 CSS 构建错误。

- [ ] Step 4: 检查最终差异范围

Run:

    git diff --check
    git status --short

Expected: 本次提交只包含会话字号、标题去重和版本更新；不得暂存或覆盖用户已有的编排、会话、工具和审批改动。

- [ ] Step 5: Commit 版本更新

    git add -- package.json package-lock.json
    git commit -m "chore: bump version to 0.1.8-snapshot"

- [ ] Step 6: 按现有打包流程生成安装包

Run:

    npm run dist:win

Expected: 生成 release/0.1.8-snapshot/ 下的 Windows 安装包和便携包，并在最终报告中列出实际生成的绝对路径。

## 完成检查

- [ ] 设置页能看到并保存“会话窗口字号”。
- [ ] 旧设置文件缺字段时应用正常启动，默认 14px。
- [ ] 完整聊天页和小窗口聊天共同响应字号设置。
- [ ] 消息、输入框、工具回执、编排信息和智能体活动信息均在会话作用域内调整。
- [ ] 页面只保留一个顶层“智能体工作台”标题。
- [ ] 普通/编排模式切换不改变字号设置。
- [ ] npm test、npm run build、npm run dist:win 均完成。
