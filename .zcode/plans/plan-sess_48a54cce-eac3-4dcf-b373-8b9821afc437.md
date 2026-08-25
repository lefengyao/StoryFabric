# StoryFabric — 智能体小说创作软件 · 第一版实施计划

## 产品定位
桌面端 AI 小说创作工作台：以「工作区」为单位管理一部小说的人物、人物关系、故事大纲、事件脉络与正文章节。内置智能体助手**不把资料塞进系统提示词**，而是通过函数调用（function calling）按需查阅工作区文件；写回操作经界面确认后落盘。

## 已确认决策
- **形态**：Electron 桌面应用（Windows 优先）
- **技术栈**：`electron-vite` 脚手架 + React 18 + TypeScript + Tailwind CSS（自绘 shadcn 风格组件 + 少量 Radix 原语）+ Zustand 状态管理
- **范围**：包含正文章节的写作与编辑
- **供应商协议**：OpenAI 兼容 + Anthropic 原生 + Gemini 原生，均支持自定义添加（名称/BaseURL/APIKey/模型列表）
- **未答复项按推荐默认执行**（批准时如不同意可指出）：
  1. 存储 = 本地文件夹 + Markdown(YAML frontmatter)，关系边列表存 `relationships.json`
  2. 智能体 = 读自由、写需确认（diff 预览后应用）
  3. 人物关系 = 力导向图谱 + 列表双视图

## 总体架构
```
渲染进程 React UI  ←IPC(preload contextBridge)→  主进程
                                                ├─ workspace/entity 服务：文件读写、frontmatter 解析(gray-matter)、全文检索
                                                ├─ llm/：协议适配器(openai-compatible / anthropic / gemini) + agentLoop（SSE 流式、工具调用循环）
                                                ├─ tools/：读写工具注册表
                                                └─ settings：userData/settings.json，APIKey 用 Electron safeStorage 加密
```
网络请求全部放在主进程（无 CORS 问题、密钥不出主进程）；流式 token 与工具调用事件通过 IPC 推给渲染进程实时渲染。

## 工作区数据规范（一个小说 = 一个文件夹）
```
我的小说/
├── storyfabric.json        # 项目元数据
├── characters/林晚.md      # frontmatter: id/name/aliases/role/tags… + 自由文本（外貌性格背景弧光）
├── relationships.json      # 边列表 [{id,fromId,toId,type,label,description}]
├── outline/01-第一卷.md    # 大纲文档树，按卷/篇分文件
├── events/夺旗之夜.md      # frontmatter: id/title/storyTime/characters[]/prev[]/next[]（因果链）
├── chapters/第001章.md     # frontmatter: id/title/volume/status + 正文
└── .storyfabric/sessions/  # 智能体会话记录(json)
```
实体 id 用 nanoid；所有文件保持人眼可读、可用其他编辑器打开。

## 智能体设计（核心需求）
- **系统提示词极小且固定**：仅角色定位 + 写作偏好 + 工具使用说明，不注入任何实体内容。
- **读取工具（自动执行）**：`list_characters` / `get_character` / `search_project(keyword)` / `get_outline` / `list_events` / `get_event` / `get_relations(characterId?)` / `list_chapters` / `get_chapter`
- **写入工具（产生待确认变更）**：`save_character` / `save_relationship` / `save_outline_doc` / `save_event` / `save_chapter`（统一 upsert 语义）
- **agentLoop**：流式响应 → 收到 tool_call：读工具立即执行并回注继续生成；写工具生成 PendingChange 推送到界面暂停等待用户「应用/拒绝」，结果回注后续跑。最多连续 10 轮工具调用防死循环；支持随时中止。
- **透明化 UX**：聊天中以折叠卡片展示「正在查阅：林晚的人物卡」「正在检索：夺旗」等工具调用过程；写操作弹出 diff 对比框确认。
- **兜底**：不支持工具调用的模型可用「@引用」——把人物/事件拖入对话内联其内容（同时作为显式上下文的补充手段）。

## 页面与功能
1. **工作区**：欢迎页（新建/打开文件夹/最近列表），新建时脚手架初始化目录
2. **人物**：卡片墙 + 搜索筛选 + 详情编辑器（结构化字段 + 自由文本）
3. **人物关系**：React Flow + d3-force 力导向图（节点=人物、连线=关系，点选高亮、可拖拽），可切列表视图
4. **大纲**：文档树 + CodeMirror 6 Markdown 编辑 + 预览切换
5. **事件脉络**：时间线卡片视图（按故事内时间排序）+ 详情（关联人物 chips、因果链跳转）
6. **章节**：卷分组的章节列表 + CodeMirror 编辑器 + 字数统计；选中文本浮出 AI 菜单（续写/润色/扩写）
7. **智能体工作台**：全页聊天 + 会话历史管理 + 快捷指令模板（生成大纲/续写本章/查设定矛盾等）
8. **设置·供应商**：供应商列表增删改、协议选择、BaseURL/Key、拉取或手动填模型、默认对话模型与快速操作模型选择；浅色/深色主题切换

## UI 设计语言
左侧 64px 图标导航（工作区/人物/关系/大纲/事件/章节/智能体/设置），内容区顶栏+卡片布局；中性灰底（zinc）+ 单一强调色（indigo），CSS 变量驱动浅/深双主题，圆角卡片、细边框、充足留白，中文字体栈优化。

## 实施里程碑
0. 仓库初始化：git init、electron-vite 脚手架、依赖安装、空窗口跑通、本计划存档至 `docs/design.md` 并提交
1. 应用壳：布局/导航/主题/路由/Zustand 基建
2. 工作区层：新建/打开/目录脚手架、entityStore(frontmatter 读写)、IPC、全局检索 —— 含 vitest 单测
3. 人物 + 关系图谱两视图
4. 大纲 + 事件脉络
5. 章节编辑器
6. 供应商管理 + 三协议适配层（OpenAI 兼容先打通，再 Anthropic/Gemini）——适配器单测（mock SSE）
7. 智能体会话：agentLoop、流式渲染、工具卡片、写确认 diff、会话持久化 —— agentLoop 状态机单测
8. 打磨与交付：快捷指令、@引用、异常与中止处理、electron-builder 打包 Windows 安装包+便携版

## 验证方式
- 每个里程碑：`npm run build` 通过 + 对应 vitest 单测通过 + 手动冒烟清单（真窗口操作验证）
- 最终验收：打包出的 exe 可安装运行，配置一个 OpenAI 兼容供应商后完整走通「新建工作区→建人物→连关系→写大纲→建事件→写一章→让智能体检索设定并续写→确认其写回」闭环

## 主要依赖
electron / electron-vite / electron-builder、react、react-dom、typescript、tailwindcss、zustand、react-router-dom、gray-matter、nanoid、@xyflow/react、d3-force、codemirror 6 (@codemirror/lang-markdown 等)、radix-ui 少量原语、vitest