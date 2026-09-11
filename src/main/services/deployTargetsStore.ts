/** 部署目标持久化（deploy-targets.json，密码经 safeStorage 加密）。 */
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import type { DeployTargetInput, DeployTargetPublic, DeployTargetStored } from '../../shared/types'
import { decryptApiKey, encryptApiKey } from './settingsService'

export class DeployTargetsStore {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly file: string) {}

  private serialized<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => undefined)
    return next
  }

  private async loadRaw(): Promise<DeployTargetStored[]> {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf-8')) as unknown
      return Array.isArray(parsed) ? (parsed as DeployTargetStored[]) : []
    } catch {
      return []
    }
  }

  private async saveRaw(list: DeployTargetStored[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    const temp = `${this.file}.${randomUUID()}.tmp`
    try {
      await writeFile(temp, JSON.stringify(list, null, 2), { encoding: 'utf-8', mode: 0o600 })
      await chmod(temp, 0o600).catch(() => undefined)
      await rename(temp, this.file)
      await chmod(this.file, 0o600).catch(() => undefined)
    } finally {
      await rm(temp, { force: true }).catch(() => undefined)
    }
  }

  list(): Promise<DeployTargetStored[]> {
    return this.serialized(() => this.loadRaw())
  }

  toPublic(target: DeployTargetStored): DeployTargetPublic {
    const { passwordEncrypted, ...rest } = target
    return {
      ...rest,
      hasPassword: Boolean(passwordEncrypted),
      passwordStorage: !passwordEncrypted ? 'none' : passwordEncrypted.startsWith('plain:') ? 'plain' : 'encrypted'
    }
  }

  passwordOf(target: DeployTargetStored): string {
    return target.passwordEncrypted ? decryptApiKey(target.passwordEncrypted) : ''
  }

  save(input: DeployTargetInput): Promise<DeployTargetStored> {
    return this.serialized(async () => {
      const list = await this.loadRaw()
      const idx = input.id ? list.findIndex((t) => t.id === input.id) : -1
      const old = idx >= 0 ? list[idx] : undefined
      const stored: DeployTargetStored = {
        id: old?.id ?? `dep_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        label: input.label,
        host: input.host,
        port: input.port,
        username: input.username,
        passwordEncrypted: input.password ? encryptApiKey(input.password) : old?.passwordEncrypted ?? '',
        hostKeyFingerprint: input.hostKeyFingerprint ?? old?.hostKeyFingerprint ?? '',
        installDir: input.installDir,
        servicePort: input.servicePort,
        baseImage: input.baseImage,
        bundleSource: 'bundled',
        os: 'linux',
        arch: old?.arch,
        distro: old?.distro,
        dockerVersion: old?.dockerVersion,
        installedVersion: old?.installedVersion,
        isRoot: old?.isRoot,
        lastDeployedAt: old?.lastDeployedAt,
        lastStatus: old?.lastStatus,
        lastError: old?.lastError
      }
      if (idx >= 0) list[idx] = stored
      else list.push(stored)
      await this.saveRaw(list)
      return stored
    })
  }

  patch(id: string, patch: Partial<DeployTargetStored>): Promise<void> {
    return this.serialized(async () => {
      const list = await this.loadRaw()
      const idx = list.findIndex((t) => t.id === id)
      if (idx < 0) return
      list[idx] = { ...list[idx], ...patch }
      await this.saveRaw(list)
    })
  }

  remove(id: string): Promise<void> {
    return this.serialized(async () => {
      const list = (await this.loadRaw()).filter((t) => t.id !== id)
      await this.saveRaw(list)
    })
  }
}
