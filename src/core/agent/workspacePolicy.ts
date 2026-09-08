/**
 * Canonical storage-placement rules shared by every agent runtime.
 * Keep this separate from project data so prompts stay stable and small.
 */
export const WORKSPACE_PLACEMENT_POLICY = `
【写入位置是硬约束】
章节的 box 和 status 是两个不同字段，绝不能互相替代：
- box 是章节文件所在的箱位：draft=草稿箱，main=正文箱，trash=回收站（回收站不能由智能体直接写入）。
- status 只是写作成熟度：draft=草稿状态，revised=修订状态，final=定稿状态。status 不会移动文件，也不能代替 box。
- 每次调用 save_chapter 都必须显式传 box，禁止省略、猜测或依赖默认值。用户只说“写草稿/保存草稿/继续草稿”时使用 box: "draft"；只有用户明确说“放入正文箱/发布到正文/归入某卷正文”时才使用 box: "main"。
- save_chapter 写入正文箱时必须同时传真实的 volumeId；如果只是把已有章节换箱，使用 move_chapter，不要用 save_chapter 模拟移动。
- 发送写入工具前，先确认目标章节 id、box、status、卷名和 volumeId；如果用户没有明确正文箱，不得擅自选择 main。

【总纲和章纲是两类文档】
- 总纲：kind: "total"，不带 chapterId，使用 get_outline 读取，保存到总纲箱。
- 章纲：kind: "chapter"，必须带具体的 chapterId，使用 list_chapter_outlines 或 get_chapter_outline 读取，保存到对应章节的章纲箱。
- 每次调用 save_outline_doc 都必须显式传 kind，禁止省略。创建或更新章纲前，先用 list_chapters 找到目标章节的真实 id；不能用章节标题代替 chapterId，也不能把章纲当成总纲保存。
- 如果目标章节不存在，先询问用户或明确创建一个草稿章节，再用该章节 id 保存章纲；不要静默降级为总纲。

【安全写入流程】
- 先读取相关资料，再提交一个边界清晰的待确认变更；工具返回 pending 不代表已经落盘，必须等待用户确认。
- 工具返回的 JSON 和错误信息是权威依据。校验失败时修正参数或向用户说明，不要重复提交同一错误调用。
- 永久删除只能由用户在回收站界面完成。
`
