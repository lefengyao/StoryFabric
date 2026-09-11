# StoryFabric 设计文档（第一版）

> 2026-08-25 定稿 · 智能体小说创作工作台

## 产品定位

桌面端 AI 小说创作软件：以「工作区」（一个本地文件夹）为单位管理一部小说的**人物、人物关系、故事大纲、事件脉络与正文章节**。内置智能体助手**不把项目资料塞进系统提示词**，而是通过 function calling 按需查阅工作区文件；写回操作必须经用户在界面确认 diff 后落盘。

## 已确认决策

| 决策点 | 结论 |
| --- | --- |
| 应用形态 | Electron 桌面应用（Windows 优先） |
| 技术栈 | electron-vite + React 19 + TypeScript + Tailwind CSS v4 + Zustand |
| v1 范围 | 含正文章节的写作与编辑 |
| 供应商协议 | OpenAI 兼容 + Anthropic 原生 + Gemini 原生，均可自定义添加 |
| 数据存储 | 工作区文件夹 + Markdown(YAML frontmatter)；关系边列表存 relationships.json |
| 智能体权限 | 读自由；写操作生成待确认变更（diff 预览 → 应用/拒绝） |
| 人物关系展示 | 力导向图谱 + 列表双视图 |

## 总体架构

```
渲染进程 React UI ←—IPC(preload contextBridge)—→ 主进程
   ├─ workspace/entity 服务：文件读写、frontmatter 解析(gray-matter)、全文检索
   ├─ llm/：协议适配器(openai-compatible / anthropic / gemini) + SSE 流式解析
   ├─ agent/：AgentService 执行循环（工具调用、写确认暂停）
   ├─ tools/：14 个工具的 schema 注册表与执行器
   └─ settings：userData/settings.json，APIKey 用 Electron safeStorage 加密
```

- 网络请求全部在主进程发起：无 CORS 问题，密钥不进渲染进程。
- 流式 token 与工具事件通过 `webContents.send('agent:event', envelope)` 推送。

## 工作区数据规范

```
我的小说/
├── storyfabric.json        # 项目元数据
├── characters/<名称>.md    # frontmatter: id/name/aliases/role/gender/age/tags/summary + 自由正文
├── relationships.json      # [{id,fromId,toId,type,label,description,directed}]
├── outline/<序号>-<标题>.md # frontmatter: id/title/order + Markdown 正文
├── events/<标题>.md        # frontmatter: id/title/storyTime/order/location/tags/characterIds/prevIds/nextIds
├── chapters/<序号>-<标题>.md# frontmatter: id/title/volume/order/status + 章节正文
└── .storyfabric/sessions/  # 智能体会话 JSON
```

实体 id 为 `<前缀>_<随机>`；文件名随名称自动维护（重命名时迁移）；所有文件人眼可读、可用其他编辑器打开。

## 智能体设计（核心需求）

- **系统提示词极小且固定**（`src/main/agent/prompts.ts`）：仅角色定位 + 「资料不在提示词中，必须用工具查阅」规则 + 工作守则。
- **读取工具（自动执行）**：`list_characters` / `get_character` / `search_project` / `get_outline` / `list_events` / `get_event` / `get_relations` / `list_chapters` / `get_chapter`
- **写入工具（产生待确认变更）**：`save_character` / `save_relationship` / `save_event` / `save_outline_doc` / `save_chapter`
- **执行循环**：最多连续 10 轮工具调用防死循环；读工具结果直接回注继续生成；写工具推送 PendingChange 事件后挂起等待用户「应用/拒绝」，结果回注后续跑；支持随时中止。
- **透明化 UX**：聊天中实时显示「正在调用 get_character(林晚)」等卡片；写操作弹出行级 diff 对比框。
- **兜底**：不支持工具调用的模型可用「@引用」把实体显式附加到消息（内容仍由模型按 id 用工具取回）。

## 协议适配层

统一内部抽象 `{system, messages[], tools[]} → {text, toolCalls[], stopReason}`：

- OpenAI 兼容：`POST {base}/chat/completions`，`Authorization: Bearer`
- Anthropic：`POST {base}/v1/messages`，`x-api-key`，tool_result 并入其后的 user 轮次
- Gemini：`POST {base}/v1beta/models/{model}:streamGenerateContent?alt=sse`，functionCall/functionResponse 映射

模型列表拉取分别走 `/models`、`/v1/models`、`/v1beta/models`。

## UI 设计语言

左侧 64px 图标导航（人物/关系/大纲/事件/章节/智能体/设置），顶栏含工作区名与刷新；中性灰底 + indigo 强调色；CSS 变量驱动浅/深双主题（Tailwind v4 `@theme inline` 映射）；圆角卡片、细边框、充足留白；编辑器为 CodeMirror 6（Markdown 语言）。

## 测试策略

- vitest 单测（node 环境）：
  - entityStore：CRUD 往返、重命名文件迁移、级联删除、检索
  - 三协议适配器：mock fetch SSE 流，验证增量文本/工具调用拼接、鉴权头、消息映射
  - AgentService：读工具回注、写确认拒绝/应用两条路径、中止
- 手动冒烟：真实窗口走通「新建工作区→建人物→连关系→写大纲→建事件→写一章→智能体检索设定并续写→确认写回」闭环。

## 后续路线（v2 候选）

选中文本润色浮窗、向量检索（RAG）、多工作流模板、章节版本快照、关系图谱布局持久化、macOS/Linux 打包。
