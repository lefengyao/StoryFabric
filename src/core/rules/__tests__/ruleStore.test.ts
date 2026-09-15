import { expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { RuleStore } from '../ruleStore'

it('rejects malformed custom rule layers before persistence', async () => {
  const store = new RuleStore(new MemoryFileStore())
  await expect(store.save([{ source: 'workspace', rules: [{ id: 'bad', kind: 'constraint', target: 'write', key: 'voice', value: 'x', severity: 'must', enabled: 'yes' } as never] }])).rejects.toThrow(/enabled|规则/)
})
