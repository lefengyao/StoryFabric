/** 生成远程命令（集中在这里，禁止在别处拼接 shell 字符串）。 */
import { shQuote, sudoPrefix } from './shell'

export interface DeployCommand {
  id: string
  title: string
  command: string
  needsSudo: boolean
}

export interface DeployContext {
  installDir: string
  servicePort: number
  baseImage: string
  version: string
  stagingDir: string
  isRoot: boolean
}

export const CONTAINER_NAME = 'storyfabric'
export const IMAGE_NAME = 'storyfabric'

/** 端口兜底：调用方已校验，这里再挡一次，避免脏值进入命令字符串 */
function safePort(value: number): number {
  return Number.isInteger(value) && value > 0 && value < 65536 ? value : 8787
}

export function probeCommands(ctx: DeployContext): DeployCommand[] {
  const sudo = sudoPrefix(ctx.isRoot)
  return [
    { id: 'probe.os', title: '检查系统', command: 'uname -s', needsSudo: false },
    { id: 'probe.arch', title: '检查架构', command: 'uname -m', needsSudo: false },
    { id: 'probe.distro', title: '检查发行版', command: 'cat /etc/os-release', needsSudo: false },
    { id: 'probe.user', title: '检查当前用户', command: 'id -u', needsSudo: false },
    { id: 'probe.sudo', title: '检查免密 sudo', command: 'sudo -n true', needsSudo: false },
    {
      id: 'probe.docker',
      title: '检查 Docker',
      // 非 root 且不在 docker 组时必须带 sudo，否则会把「权限不足」误判成「未安装」
      command: `${sudo}docker version --format '{{.Server.Version}}'`,
      needsSudo: true
    },
    {
      id: 'probe.port',
      title: '检查端口占用',
      command: `ss -ltn ${shQuote(`sport = :${safePort(ctx.servicePort)}`)}`,
      needsSudo: false
    },
    {
      id: 'probe.image',
      title: '检查已安装版本',
      command: `${sudo}docker inspect --format '{{.Config.Image}}' ${CONTAINER_NAME}`,
      needsSudo: true
    }
  ]
}

export function prepareCommands(ctx: DeployContext): DeployCommand[] {
  return [
    {
      id: 'prepare.dir',
      title: '创建安装目录',
      command: `${sudoPrefix(ctx.isRoot)}mkdir -p ${shQuote(`${ctx.installDir}/data`)} ${shQuote(`${ctx.installDir}/secrets`)}`,
      needsSudo: true
    }
  ]
}

export function buildCommands(ctx: DeployContext): DeployCommand[] {
  const image = shQuote(`${IMAGE_NAME}:${ctx.version}`)
  const sudo = sudoPrefix(ctx.isRoot)
  return [
    ...prepareCommands(ctx),
    {
      id: 'image.exists',
      title: '检查镜像是否已存在',
      command: `${sudo}docker image inspect ${image} >/dev/null 2>&1`,
      needsSudo: true
    },
    {
      id: 'build',
      title: '构建镜像',
      // cd 是 shell 内建命令，不能被 sudo 前缀，否则 sudo 找不到该命令
      command: `cd ${shQuote(ctx.stagingDir)} && ${sudo}docker build -f Dockerfile.runtime -t ${image} --build-arg BASE_IMAGE=${shQuote(ctx.baseImage)} .`,
      needsSudo: true
    }
  ]
}

export function runCommands(ctx: DeployContext): DeployCommand[] {
  const image = shQuote(`${IMAGE_NAME}:${ctx.version}`)
  const keyPath = `${ctx.installDir}/secrets/storyfabric_key`
  const sudo = sudoPrefix(ctx.isRoot)
  return [
    {
      id: 'key.generate',
      title: '生成访问密钥',
      // 幂等：密钥已存在就保留（更新时不能换密钥，否则用户手里的旧密钥会失效）
      command: `${sudo}sh -c ${shQuote(
        `umask 077; [ -f ${shQuote(keyPath)} ] || openssl rand -base64 32 > ${shQuote(keyPath)}`
      )}`,
      needsSudo: true
    },
    { id: 'key.read', title: '读取访问密钥', command: `${sudo}cat ${shQuote(keyPath)}`, needsSudo: true },
    {
      id: 'run.rm',
      title: '移除旧容器',
      command: `${sudo}docker rm -f ${CONTAINER_NAME} >/dev/null 2>&1 || true`,
      needsSudo: true
    },
    {
      id: 'run.start',
      title: '启动容器',
      command: [
        `${sudo}docker run -d --name ${CONTAINER_NAME} --restart unless-stopped`,
        `-p ${safePort(ctx.servicePort)}:8787`,
        `-v ${shQuote(`${ctx.installDir}/data`)}:/data`,
        `-v ${shQuote(keyPath)}:/run/secrets/storyfabric_key:ro`,
        '-e STORYFABRIC_ACCESS_KEY_FILE=/run/secrets/storyfabric_key',
        image
      ].join(' '),
      needsSudo: true
    }
  ]
}

export function healthCommand(ctx: DeployContext): DeployCommand {
  return {
    id: 'health',
    title: '健康检查',
    command: `${sudoPrefix(ctx.isRoot)}docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' ${CONTAINER_NAME}`,
    needsSudo: true
  }
}

export function logsCommand(ctx: DeployContext): DeployCommand {
  return {
    id: 'logs',
    title: '查看日志',
    command: `${sudoPrefix(ctx.isRoot)}docker logs --tail 200 ${CONTAINER_NAME}`,
    needsSudo: true
  }
}

export function uninstallCommands(ctx: DeployContext): DeployCommand[] {
  const sudo = sudoPrefix(ctx.isRoot)
  return [
    {
      id: 'uninstall.container',
      title: '删除容器',
      // 不加 `|| true`：调用方按退出码判断，「容器不存在」由调用方单独放行
      command: `${sudo}docker rm -f ${CONTAINER_NAME}`,
      needsSudo: true
    },
    {
      id: 'uninstall.image',
      title: '删除镜像',
      command: `${sudo}docker rmi ${shQuote(`${IMAGE_NAME}:${ctx.version}`)}`,
      needsSudo: true
    },
    { id: 'cleanup.staging', title: '清理上传目录', command: `rm -rf ${shQuote(ctx.stagingDir)}`, needsSudo: false }
  ]
}
