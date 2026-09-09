import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import type { UsageRecord } from '../../../shared/types'
import { UsageService } from '../usageService'

const record = (at: number): UsageRecord => ({
  at,
  providerId: 'p1',
  providerName: '供应商',
  model: 'm1',
  promptTokens: 10,
  completionTokens: 5,
  cachedTokens: 2,
  cacheWriteTokens: 0
})

async function withService(run: (service: UsageService, filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'sf-usage-'))
  try {
    await run(new UsageService(join(dir, 'usage.json')), join(dir, 'usage.json'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('UsageService', () => {
  it('追加后能按顺序读回', async () => {
    await withService(async (service) => {
      await service.append(record(1))
      await service.append(record(2))
      expect((await service.list()).map((item) => item.at)).toEqual([1, 2])
    })
  })

  it('并发追加不互相覆盖', async () => {
    await withService(async (service) => {
      await Promise.all(Array.from({ length: 20 }, (_, i) => service.append(record(i))))
      expect(await service.list()).toHaveLength(20)
    })
  })

  it('文件缺失或损坏时返回空数组', async () => {
    await withService(async (service, filePath) => {
      expect(await service.list()).toEqual([])
      await writeFile(filePath, '{bad json', 'utf-8')
      expect(await service.list()).toEqual([])
    })
  })

  it('落盘为可读 JSON 数组', async () => {
    await withService(async (service, filePath) => {
      await service.append(record(1))
      const text = await readFile(filePath, 'utf-8')
      expect(JSON.parse(text)).toHaveLength(1)
    })
  })
})
