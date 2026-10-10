# 0.1.7-snapshot 编排、Skill 与交互改造结果

日期：2026-09-18

## 已交付

- 结构化 `ask_user` 问题协议：支持单选、多选和自定义文本，问题会暂停当前运行并在回答后恢复同一阶段。
- Skill 自动发现与固定运行快照：加入 `planning-first`、`require-clarification` 等内置 Skill；智能体可提出 Skill 包候选，但必须经过用户确认后安装或启用。
- 单智能体编排与多智能体编排：单模式统一使用会话模型，多模式按阶段配置模型。
- 正文写作硬门禁：计划、设定、提示词阶段未完成时，正文阶段不能写入章节。
- 会话级审批、创作配置和平台桥接：Electron、HTTP/SSE、Android 使用同一套问题回答与 Skill 候选确认接口。
- renderer 问题/Skill 弹窗、运行等待状态、上下文圆环、编排信息面板和浮层关闭恢复。
- Skill 候选并发幂等、安装失败回滚、普通模式混合控制工具保护、取消后等待状态清理。

## 验证结果

执行：

```text
npm test -- --reporter=dot
npx tsc -p tsconfig.web.json --noEmit
npx tsc -p tsconfig.node.json --noEmit
git diff --check
npm run server:bundle
npm run dist:win
```

结果：158 个测试文件，772 个测试通过，1 个测试按预期跳过；web/node 类型检查通过；`git diff --check` 通过；服务端与 Windows 构建成功。

## 0.1.7-snapshot 产物

- Windows 安装器：[StoryFabric-Setup-0.1.7-snapshot.exe](D:/生产项目/项目/TrailblazerStation/StoryFabricAllConsole/StoryFabric/release/0.1.7-snapshot/StoryFabric-Setup-0.1.7-snapshot.exe)
- Windows 便携包：[StoryFabric-Portable-0.1.7-snapshot.zip](D:/生产项目/项目/TrailblazerStation/StoryFabricAllConsole/StoryFabric/release/0.1.7-snapshot/StoryFabric-Portable-0.1.7-snapshot.zip)
- 独立服务端包：[storyfabric-server-0.1.7-snapshot.tar.gz](D:/生产项目/项目/TrailblazerStation/StoryFabricAllConsole/StoryFabric/release/0.1.7-snapshot/storyfabric-server-0.1.7-snapshot.tar.gz)

版本校验：源码、`package-lock.json` 根版本、`server-bundle/VERSION`、独立 tar 内 `VERSION`、Windows 内嵌 tar 内 `VERSION`、`latest.yml` 和安装器文件名均为 `0.1.7-snapshot`。

两份服务端包 SHA256（必须一致）：

```text
B5650566F027419B235BF947E00ACAD43EF94B3BA9FE1E39ACAFA14828D95695
```

## 视觉验收状态

布局与上下文计算单测通过，构建产物包含对应 renderer 改动。640px、1100px、1440px 的实时浏览器截图烟测未执行：当前 Codex 环境没有可用浏览器自动化实例。该项仍需在真实桌面窗口中确认编排展开/收起、弹窗外部关闭、右键菜单恢复和长中文排版。

本次没有自动安装 Windows 包。
