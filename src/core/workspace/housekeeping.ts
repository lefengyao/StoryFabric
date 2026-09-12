import type { FileStore } from '../storage/fileStore'

const DEFAULT_MAX_AGE = 24 * 60 * 60 * 1000

async function filesRecursively(store: FileStore, dir: string): Promise<string[]> {
  const files = (await store.listFiles(dir)).map((file) => (dir ? `${dir}/${file}` : file))
  for (const child of await store.listDirs(dir)) {
    const childPath = dir ? `${dir}/${child}` : child
    if (childPath === 'docs' || childPath.startsWith('docs/')) continue
    files.push(...(await filesRecursively(store, childPath)))
  }
  return files
}

/**
 * 只清理明确的临时产物。正文、frontmatter、索引和会话文件不在清理范围内。
 * `.storyfabric/tmp` 是应用专用临时目录，可直接清空；其它 `.tmp/.bak`
 * 文件只有在能确认超过 24 小时后才删除。
 */
export async function cleanupWorkspace(store: FileStore, now = Date.now(), maxAge = DEFAULT_MAX_AGE): Promise<number> {
  let removed = 0
  if (await store.exists('.storyfabric/tmp')) {
    const files = await filesRecursively(store, '.storyfabric/tmp')
    await store.remove('.storyfabric/tmp')
    await store.ensureDir('.storyfabric/tmp')
    removed += files.length
  }

  for (const path of await filesRecursively(store, '')) {
    if (path.startsWith('.storyfabric/tmp/')) continue
    if (!path.toLowerCase().endsWith('.tmp') && !path.toLowerCase().endsWith('.bak')) continue
    const modified = await store.modifiedAt?.(path)
    if (modified === null || modified === undefined || now - modified < maxAge) continue
    await store.remove(path)
    removed++
  }
  return removed
}
