export const CHAPTER_TEXT_CANDIDATE_PURPOSE = 'chapter-text-candidate' as const
export const CHAPTER_POLISH_PURPOSE = 'chapter-polish-candidate' as const
export const CHAPTER_DE_AI_PURPOSE = 'chapter-de-ai-candidate' as const

export type ChapterTextCandidatePurpose =
  | typeof CHAPTER_TEXT_CANDIDATE_PURPOSE
  | typeof CHAPTER_POLISH_PURPOSE
  | typeof CHAPTER_DE_AI_PURPOSE

export type OrdinaryChapterAgentStage = 'polish' | 'anti-ai'

export function ordinaryChapterAgentLabel(stage: OrdinaryChapterAgentStage): string {
  return stage === 'polish' ? 'AI 润色智能体' : '去 AI 风格智能体'
}

export function isChapterTextCandidatePurpose(purpose: string | undefined): purpose is ChapterTextCandidatePurpose {
  return purpose === CHAPTER_TEXT_CANDIDATE_PURPOSE || purpose === CHAPTER_POLISH_PURPOSE || purpose === CHAPTER_DE_AI_PURPOSE
}

export function ordinaryChapterAgentStage(purpose: string | undefined, message = ''): OrdinaryChapterAgentStage | undefined {
  if (purpose === CHAPTER_POLISH_PURPOSE) return 'polish'
  if (purpose === CHAPTER_DE_AI_PURPOSE) return 'anti-ai'
  if (purpose !== CHAPTER_TEXT_CANDIDATE_PURPOSE) return undefined
  return /去\s*AI|自然化/i.test(message) ? 'anti-ai' : 'polish'
}
