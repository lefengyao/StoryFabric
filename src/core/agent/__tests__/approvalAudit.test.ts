import { describe, expect, it } from 'vitest'
import { ApprovalAuditLog } from '../approvalAudit'

describe('ApprovalAuditLog', () => {
  it('appends an audit entry with a parameter digest and terminal result', async () => {
    const log = new ApprovalAuditLog()
    const id = await log.request({ runId: 'r', goalId: 'g', taskId: 't', toolName: 'save_note', argsJson: '{"note":{"content":"secret"}}', policy: 'strict' })
    await log.resolve(id, { decision: 'approved', result: 'applied', resultSummary: '写入成功' })
    const entry = log.list('r')[0]
    expect(entry).toMatchObject({ id, decision: 'approved', result: 'applied', argsDigest: expect.any(String) })
    expect(JSON.stringify(entry)).not.toContain('secret')
  })

  it('keeps the first terminal decision when resolve is repeated', async () => {
    const log = new ApprovalAuditLog()
    const id = await log.request({ runId: 'r', toolName: 'save_note', argsJson: '{}', policy: 'strict' })
    await log.resolve(id, { decision: 'rejected', result: 'rejected' })
    await log.resolve(id, { decision: 'approved', result: 'applied' })
    expect(log.list('r')[0]).toMatchObject({ decision: 'rejected', result: 'rejected' })
  })
})
