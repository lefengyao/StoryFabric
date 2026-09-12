import { describe, expect, it } from 'vitest'
import { decodeSessionArchive, exportSessionArchive } from '../sessionArchive'
import type { ChatSession } from '../../../shared/types'

describe('session archive', () => {
  it('round-trips files and per-session model preferences', () => {
    const session: ChatSession = {
      id: 'sess_1', title: '测试', createdAt: 1, updatedAt: 2, archived: false,
      modelPreferences: [{ providerId: 'p1', model: 'vision', reasoning: 'high' }],
      messages: [{ id: 'm1', role: 'user', text: '看看', files: [{ kind: 'text', id: 'f1', name: '说明.txt', mimeType: 'text/plain', size: 6, text: '你好' }] }]
    }
    const decoded = decodeSessionArchive(exportSessionArchive(session).base64)
    expect(decoded.messages[0].files).toEqual(session.messages[0].files)
    expect(decoded.modelPreferences).toEqual(session.modelPreferences)
  })

  it('rejects invalid attachment archives', () => {
    const session: ChatSession = { id: 'sess_1', title: '坏', createdAt: 1, updatedAt: 1, archived: false, messages: [{ id: 'm', role: 'user', files: [{ kind: 'image', id: 'i', name: 'x.png', mimeType: 'image/png', size: 1, base64: 'AA==' }] }] }
    expect(() => decodeSessionArchive(exportSessionArchive(session).base64)).toThrow()
  })
})
