import type { UsageRecord } from '../../shared/types'
import type { FileStore } from '../storage/fileStore'
import { UsageArchiveStore, type UsageBucket } from './usageArchive'

const USAGE_PATH = '.storyfabric/usage-records.json'

export class PortableUsageStore {
  private readonly archive: UsageArchiveStore

  constructor(store: FileStore, path = USAGE_PATH) {
    this.archive = new UsageArchiveStore(store, path, '.storyfabric/usage-stats')
  }

  list(): Promise<UsageRecord[]> { return this.archive.list() }
  listBuckets(): Promise<UsageBucket[]> { return this.archive.listBuckets() }
  append(record: UsageRecord): Promise<void> { return this.archive.append(record) }
}
