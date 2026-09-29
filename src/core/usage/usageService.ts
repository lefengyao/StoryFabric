/** Model usage: recent raw calls plus durable monthly hourly aggregates. */
import { basename, dirname } from 'path'
import type { UsageRecord } from '../../shared/types'
import { NodeFileStore } from '../storage/nodeFileStore'
import { UsageArchiveStore, type UsageBucket } from './usageArchive'

export class UsageService {
  private readonly archive: UsageArchiveStore

  constructor(filePath: string) {
    this.archive = new UsageArchiveStore(new NodeFileStore(dirname(filePath)), basename(filePath), 'usage-stats')
  }

  list(): Promise<UsageRecord[]> { return this.archive.list() }
  listBuckets(): Promise<UsageBucket[]> { return this.archive.listBuckets() }
  append(record: UsageRecord): Promise<void> { return this.archive.append(record) }
}
