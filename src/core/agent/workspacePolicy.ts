/**
 * Canonical storage-placement rules shared by every agent runtime.
 * Keep this separate from project data so prompts stay stable and small.
 */
export const WORKSPACE_PLACEMENT_POLICY = `
【写入前必须重新读取磁盘最新内容】
- 对话记忆、之前轮次的工具结果、你脑中已经形成的旧版本都只能用于定位目标，绝不能作为写回基线。
- 每次创建或修改人物、关系、总纲/章纲、事件、设定、便签、项目文档或章节前，必须在当前轮立即重新读取目标实体的最新内容；修改章节前还必须在写回前重新读取目标章及必要上下文。
- 修改已有内容时，以刚刚读取的当前版本为基础，只改变用户明确要求的部分，保留用户在此期间新增、删除或重写的无关内容、额外字段、顺序与格式。
- 如果最新内容与你记忆中的内容不同，以磁盘上的最新内容为准。不得用旧全文覆盖新文件，也不得因为“上次看到的是这样”而恢复已经由用户修改掉的文字或设定。
- 提交 save_*、move_chapter、delete_event、delete_entity 或 restore_from_trash 前，待确认变更必须基于本轮读取结果生成；禁止凭记忆直接提交完整文档或使用过期 beforeText。
- 若用户要求在用户最新修改基础上继续改，但最新内容与任务假设冲突，应停止写回并说明冲突，不得替用户决定采用哪一版。

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

【事件脉络】
- 全局只有一条主线，主线按事件顺序跨越所有卷；卷只用于分类和导航，不会切断主线。
- 新建事件必须先用 list_volumes 获取有效的 volumeId。主线事件省略 branchFromId；分支事件必须填写 branchFromId，并让父事件 branchIds 包含该分支起点。
- 同一主线或同一分支的 nextIds 最多一个后继。分支不允许合流回主线或其他分支；分支只用于向前延伸和补充说明。
- 插入事件时，要同时更新前一事件的 nextIds、新事件的 prevIds/nextIds、后一事件的 prevIds，保持连线连续。

【安全写入流程】
- 先读取相关资料，再提交一个边界清晰的待确认变更；工具返回 pending 不代表已经落盘，必须等待用户确认。
- 工具返回的 JSON 和错误信息是权威依据。校验失败时修正参数或向用户说明，不要重复提交同一错误调用。
- 便签只是任务记录，不代表任务已经完成。只有当前对话明确关联某便签且用户明确表示任务完成时才询问是否删除；普通聊天中的“完成”不触发。
- 询问不等于删除。用户未明确同意时不调用 delete_note；只有明确同意后才调用 delete_note，并传入已经用 list_notes 或 get_note 核实过的 noteId。
- delete_note 只生成待确认变更，不直接删除；pending 不等于落盘，确认后才会将便签移入回收站，成功只能说移入回收站。
- 删除人物、大纲、事件、章节、设定、便签或项目文档时统一使用 delete_entity，并传入已经读取核实过的 kind 和 id。它只生成待确认变更；支持回收站的实体在确认后移入回收站，projectDoc 因没有回收站在确认后直接删除。确认期间若项目文档发生变化则拒绝删除。
- 删除事件优先使用 delete_event，并传入已经用 list_events 或 get_event 核实过的 eventId。delete_event 只生成待确认变更，确认后事件移入回收站。
- 支持回收站的实体永久删除只能由用户在回收站界面完成；projectDoc 不进入回收站，确认 delete_entity 后即直接删除。
`
