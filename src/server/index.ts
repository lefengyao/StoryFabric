import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { createStoryFabricServer } from './server'
import { WorkspaceRegistry } from './workspaceRegistry'

async function readAccessKey(): Promise<string> {
  const direct = process.env.STORYFABRIC_ACCESS_KEY?.trim()
  if (direct) return direct
  const file = process.env.STORYFABRIC_ACCESS_KEY_FILE?.trim()
  if (file) return (await fs.readFile(file, 'utf8')).trim()
  throw new Error('必须设置 STORYFABRIC_ACCESS_KEY 或 STORYFABRIC_ACCESS_KEY_FILE')
}

async function main(): Promise<void> {
  const dataDir = process.env.STORYFABRIC_DATA_DIR?.trim() || '/data'
  const legacyWorkspace = process.env.STORYFABRIC_WORKSPACE_DIR?.trim() || join(dataDir, 'workspace')
  const settingsPath = process.env.STORYFABRIC_SETTINGS_FILE?.trim() || join(dataDir, 'settings.json')
  const staticDir = process.env.STORYFABRIC_WEB_DIST_DIR?.trim() || join(process.cwd(), 'web')
  const accessKey = await readAccessKey()
  const registry = await WorkspaceRegistry.open(dataDir, legacyWorkspace)

  const server = createStoryFabricServer({
    accessKey,
    dataDir,
    workspaceRegistry: registry,
    settingsPath,
    staticDir,
    cookieSecure: process.env.STORYFABRIC_COOKIE_SECURE === '1'
  })
  const port = Number(process.env.PORT || 8787)
  const host = process.env.HOST || '0.0.0.0'
  const sockets = new Set<import('node:net').Socket>()
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  server.listen(port, host, () => {
    console.log(`StoryFabric Linux server listening on http://${host}:${port}`)
  })

  const shutdown = (): void => {
    for (const socket of sockets) socket.destroy()
    server.close(() => process.exit(0))
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
