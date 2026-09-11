# Windows 写作工作流

Windows 端使用 Electron，工作区是普通文件夹，目录和 Android 共享：

```text
characters/primary|secondary
outline/total|chapters/<chapterId>
settings/background|other
chapters/draft|main/<volumeId>
notes/
.storyfabric/trash
```

推荐验收顺序：创建工作区，创建卷和章节，在草稿箱编辑后移入正文箱；再创建总纲、章纲、主要/次要角色、背景/其他设定和便签。删除操作进入回收站，恢复从章节页或相应资料页完成。

智能体读取采用按需模式：章节修改前读取目标章及前后各两章；陌生名词先查术语索引、设定、大纲和章节标注。写入、移动、恢复均显示待确认 Diff，拒绝不会写盘。

诊断时先运行 `npx tsc -b --pretty false`、`npm test -- --run` 和 `npm run build`。工作区临时文件由共享清理策略处理；仓库构建目录使用 `scripts/clean-build-artifacts.ps1`，不要使用 `git clean -fdx`。
