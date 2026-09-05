import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { createStoryFabricServer, ensureServerWorkspace } from './server'

async function readAccessKey(): Promise<string> {
  const direct = process.env.STORYFABRIC_ACCESS_KEY?.trim()
  if (direct) return direct
  const file = process.env.STORYFABRIC_ACCESS_KEY_FILE?.trim()
  if (file) return (await fs.readFile(file, 'utf8')).trim()
  throw new Error('必须设置 STORYFABRIC_ACCESS_KEY 或 STORYFABRIC_ACCESS_KEY_FILE')
}

async function main(): Promise<void> {
  const workspaceRoot = process.env.STORYFABRIC_WORKSPACE_DIR?.trim() || '/data/workspace'
  const settingsPath = process.env.STORYFABRIC_SETTINGS_FILE?.trim() || join('/data', 'settings.json')
  const staticDir = process.env.STORYFABRIC_WEB_DIST_DIR?.trim() || join(process.cwd(), 'web')
  const accessKey = await readAccessKey()
  await ensureServerWorkspace(workspaceRoot, process.env.STORYFABRIC_WORKSPACE_NAME?.trim() || 'StoryFabric')

  const server = createStoryFabricServer({
    accessKey,
    workspaceRoot,
    settingsPath,
    staticDir,
    cookieSecure: process.env.STORYFABRIC_COOKIE_SECURE === '1'
  })
  const port = Number(process.env.PORT || 8787)
  const host = process.env.HOST || '0.0.0.0'
  server.listen(port, host, () => {
    console.log(`StoryFabric Linux server listening on http://${host}:${port}`)
  })

  const shutdown = (): void => {
    server.close(() => process.exit(0))
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
