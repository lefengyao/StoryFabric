import { useEffect, useState } from 'react'
import type { AgentQuestion, AgentQuestionAnswer } from '../../../../shared/agentQuestions'
import { validateAgentQuestionAnswer } from '../../../../shared/agentQuestions'
import { Button, Field } from '../ui/primitives'
import { Modal } from '../ui/modal'

export function AgentQuestionDialog({
  question,
  open,
  onClose,
  onSubmit
}: {
  question: AgentQuestion | null
  open: boolean
  onClose: () => void
  onSubmit: (answer: AgentQuestionAnswer) => Promise<void>
}): React.ReactElement | null {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!question) return
    const initial: Record<string, string | string[]> = {}
    for (const field of question.fields) {
      if (field.defaultValue !== undefined) initial[field.id] = field.defaultValue
    }
    setAnswers(initial)
    setError(null)
    setSubmitting(false)
  }, [question?.questionId])

  if (!question) return null

  const submit = async (): Promise<void> => {
    const answer: AgentQuestionAnswer = { questionId: question.questionId, answers }
    try {
      validateAgentQuestionAnswer(question, answer)
      setError(null)
      setSubmitting(true)
      await onSubmit(answer)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={(next) => { if (!next) onClose() }} title={question.title} description={question.description} wide>
      <div className="space-y-4">
        {question.fields.map((field) => {
          const value = answers[field.id]
          if (field.type === 'text') {
            return (
              <Field key={field.id} label={`${field.label}${field.required ? '（必填）' : ''}`}>
                <textarea
                  value={typeof value === 'string' ? value : ''}
                  onChange={(event) => setAnswers((current) => ({ ...current, [field.id]: event.target.value }))}
                  placeholder={field.placeholder}
                  rows={4}
                  className="w-full resize-y rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
              </Field>
            )
          }

          const selected = field.type === 'multi' ? (Array.isArray(value) ? value : []) : (typeof value === 'string' ? value : '')
          return (
            <Field key={field.id} label={`${field.label}${field.required ? '（必填）' : ''}`}>
              <div className="space-y-2 rounded-lg border border-line bg-app/40 p-2">
                {(field.options ?? []).map((option) => {
                  const checked = field.type === 'multi' ? selected.includes(option.id) : selected === option.id
                  return (
                    <label key={option.id} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-elevated">
                      <input
                        type={field.type === 'multi' ? 'checkbox' : 'radio'}
                        name={field.id}
                        checked={checked}
                        onChange={() => setAnswers((current) => {
                          if (field.type === 'multi') {
                            const currentValues = Array.isArray(current[field.id]) ? current[field.id] as string[] : []
                            return { ...current, [field.id]: checked ? currentValues.filter((id) => id !== option.id) : [...currentValues, option.id] }
                          }
                          return { ...current, [field.id]: option.id }
                        })}
                        className="mt-0.5 accent-[var(--accent)]"
                      />
                      <span className="min-w-0">
                        <span className="block text-fg">{option.label}</span>
                        {option.description && <span className="block text-xs leading-5 text-muted">{option.description}</span>}
                      </span>
                    </label>
                  )
                })}
              </div>
            </Field>
          )
        })}
        {error && <div role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">{error}</div>}
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>稍后处理</Button>
          <Button variant="primary" onClick={() => void submit()} loading={submitting}>提交回答</Button>
        </div>
      </div>
    </Modal>
  )
}
