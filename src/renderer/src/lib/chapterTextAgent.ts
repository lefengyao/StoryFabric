import type { AgentGenerationPreferences } from '../../../shared/agentGeneration'
import { CHAPTER_DE_AI_PURPOSE, CHAPTER_POLISH_PURPOSE, type ChapterTextCandidatePurpose } from '../../../shared/agentTask'

export type ChapterTextAgent = 'polish' | 'de-ai'

export interface ChapterAgentTarget {
  id: string
  title: string
}

export function chapterTextAgentTask(agent: ChapterTextAgent, chapter: ChapterAgentTarget): string {
  const name = agent === 'polish' ? 'AI 润色智能体' : '去 AI 风格智能体'
  const guidance = agent === 'polish'
    ? '在不改变事实、人物关系、叙事视角、情节和结局的前提下润色表达。'
    : '减少模板化总结、机械连接词和均质对白，保留作者有意的重复、节奏和个性，不改变事实、人物关系、叙事视角、情节和结局。'
  return '请使用普通模式' + name + '处理章节「' + chapter.title + '」（id=' + chapter.id + '）。先用 get_chapter 按 id 读取并确认完整正文；如果正文需要分页，必须读完所有页。' + guidance + ' 仅回复完整候选正文，不要调用任何写入工具或替换项目内容，等待用户审阅和选择。'
}

export function chapterTextAgentEnabled(agent: ChapterTextAgent, preferences: AgentGenerationPreferences | undefined): boolean {
  if (agent === 'polish') return preferences?.polishAgentEnabled !== false
  return preferences?.deAiAgentEnabled !== false
}

export function chapterTextAgentPurpose(agent: ChapterTextAgent): ChapterTextCandidatePurpose {
  return agent === 'polish' ? CHAPTER_POLISH_PURPOSE : CHAPTER_DE_AI_PURPOSE
}
