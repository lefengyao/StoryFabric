/**
 * 生成随安装包分发的服务端部署包：release/<version>/storyfabric-server-<version>.tar.gz
 * 内容清单在本脚本中明确列出，供手动 Docker 部署使用。
 */
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { create as tarCreate } from 'tar'

const root = resolve(import.meta.dirname, '..')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf-8'))
const version = pkg.version
const releaseDir = join(root, 'release')
const versionDir = join(releaseDir, version)
const stage = join(versionDir, 'server-bundle')
const outFile = join(versionDir, `storyfabric-server-${version}.tar.gz`)
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
// npm 脚本里会设置 npm_execpath；用它直接调 node，避免 Windows 上 .cmd + shell 的 EINVAL 与弃用告警
const npmCli = process.env.npm_execpath

function run(script) {
  if (npmCli) {
    execFileSync(process.execPath, [npmCli, 'run', script], { cwd: root, stdio: 'inherit' })
    return
  }
  execFileSync(npmCmd, ['run', script], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
}

run('web:build')
run('server:build')

await rm(stage, { recursive: true, force: true })
await mkdir(stage, { recursive: true })
await cp(join(root, 'dist-server'), join(stage, 'dist-server'), { recursive: true })
await cp(join(root, 'out', 'web'), join(stage, 'web'), { recursive: true })
await cp(join(root, 'resources', 'Dockerfile.runtime'), join(stage, 'Dockerfile.runtime'))
await cp(join(root, 'resources', 'compose.runtime.yml'), join(stage, 'compose.runtime.yml'))
await cp(join(root, 'scripts', 'docker-entrypoint.sh'), join(stage, 'docker-entrypoint.sh'))
await writeFile(join(stage, 'VERSION'), `${version}\n`, 'utf-8')

const sums = []
async function bundleFiles(dir) {
  const files = []
  for (const entry of await readdir(join(stage, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) files.push(...await bundleFiles(path))
    else if (entry.isFile()) files.push(path)
  }
  return files.sort()
}
for (const entry of [...await bundleFiles('dist-server'), ...await bundleFiles('web'), 'Dockerfile.runtime', 'docker-entrypoint.sh', 'compose.runtime.yml', 'VERSION']) {
  const hash = createHash('sha256').update(await readFile(join(stage, entry))).digest('hex')
  sums.push(`${hash}  ${entry}`)
}
await writeFile(join(stage, 'SHA256SUMS'), `${sums.join('\n')}\n`, 'utf-8')

await rm(outFile, { force: true })
await pipeline(tarCreate({ gzip: true, cwd: stage, portable: true }, await readdir(stage)), createWriteStream(outFile))

const archiveHash = createHash('sha256').update(await readFile(outFile)).digest('hex')
console.log(`[server-bundle] ${outFile}`)
console.log(`[server-bundle] sha256=${archiveHash}`)
