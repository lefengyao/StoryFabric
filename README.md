# StoryFabric

依托智能体的小说创作工作台（Electron 桌面应用）。

## 功能（v1）

- **工作区**：一部小说 = 一个本地文件夹；所有数据为可读的 Markdown / JSON
- **人物**：结构化字段 + 自由 Markdown 人物卡
- **人物关系**：力导向图谱 + 列表双视图
- **故事大纲**：多文档树 + CodeMirror 编辑
- **事件脉络**：时间线视图，支持关联人物与因果链
- **章节正文**：按卷分组目录、字数统计、AI 续写入口
- **智能体工作台**：流式对话；智能体通过工具**按需查阅**项目资料（资料不进入系统提示词），写回需界面确认
- **供应商管理**：OpenAI 兼容 / Anthropic / Gemini 三协议自定义接入；密钥系统级加密存本机

## 开发

```bash
npm install       # 安装依赖
npm run dev       # 启动开发模式
npm test          # 运行单元测试
npm run dist      # 打包 Windows 安装包 + 便携版（输出 release/）
```

设计文档见 [docs/design.md](docs/design.md)。
