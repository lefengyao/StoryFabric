import { BookOpen, FolderOpen, FolderPlus, History, Server } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { BrandMark } from '../../components/icons/BrandMark'
import { Button, Card, Field, Input } from '../../components/ui/primitives'
import { Modal } from '../../components/ui/modal'
import { DeployWizard } from './DeployWizard'
import { RecentWorkspaceList } from './RecentWorkspaceList'
import { api } from '../../lib/api'
import { useWorkspace } from '../../stores/workspaceStore'
import { getLocalPlatformApi, getPlatformApi, isWebPlatform } from '../../platform/platformApi'
import { HttpPlatformApi } from '../../platform/httpApi'
import { installPlatformApi } from '../../platform/platformApi'
import { loginRemote } from '../../platform/webAuth'
import { readWorkspaceArchiveFile, WORKSPACE_ARCHIVE_ACCEPT } from '../../lib/workspaceArchiveFile'
import type { StoryFabricApi, WorkspaceImportTarget } from '../../../../shared/api'
import type { DeployTargetPublic, WorkspaceListItem } from '../../../../shared/types'

/** 服务器部署与远程连接尚未完成可用性验证，稳定版暂不向用户开放。 */
export const SERVER_DEPLOYMENT_ENABLED = false

export function createRecentConfigKey(
  isWeb: boolean,
  isAndroid: boolean,
  mode: 'local' | 'remote',
  serviceRoot: string,
  serviceKey: string
): string {
  return JSON.stringify([isWeb, isAndroid, mode, serviceRoot, serviceKey])
}

export function shouldAutoLoadRecentWorkspaces(
  isWeb: boolean,
  mode: 'local' | 'remote',
  serviceConfigSubmitted: boolean
): boolean {
  return isWeb || mode === 'local' || serviceConfigSubmitted
}

export function isWorkspaceRequestCurrent(
  expectedConfigKey: string,
  currentConfigKey: string,
  expectedLoadId: number,
  currentLoadId: number
): boolean {
  return expectedConfigKey === currentConfigKey && expectedLoadId === currentLoadId
}

export interface WorkspaceOpenRequestGuard {
  isCurrent: () => boolean
}

export function createWorkspaceOpenRequestGuard(
  expectedConfigKey: string,
  expectedRequestId: number,
  isMounted: () => boolean,
  getCurrentConfigKey: () => string,
  getCurrentRequestId: () => number
): WorkspaceOpenRequestGuard {
  return {
    isCurrent: () => isMounted() && expectedConfigKey === getCurrentConfigKey() && expectedRequestId === getCurrentRequestId()
  }
}

export function shouldClearWorkspaceLoading(
  mounted: boolean,
  expectedConfigKey: string,
  loadingConfigKey: string | null,
  expectedLoadId: number,
  loadingLoadId: number | null
): boolean {
  return mounted && loadingConfigKey !== null && loadingLoadId !== null && isWorkspaceRequestCurrent(
    expectedConfigKey,
    loadingConfigKey,
    expectedLoadId,
    loadingLoadId
  )
}

export function shouldClearRecentWorkspaceOpening(
  mounted: boolean,
  expectedRequestId: number,
  currentRequestId: number
): boolean {
  return mounted && expectedRequestId === currentRequestId
}

export function shouldCloseWorkspacePicker(
  nextOpen: boolean,
  _workspaceLoading: boolean,
  _workspaceActionBusy: boolean
): boolean {
  return !nextOpen
}

export async function openRecentWorkspaceThenRefresh(
  path: string,
  openWorkspace: (path: string) => Promise<void>,
  refreshRecent: () => void | Promise<void>,
  isCurrent: () => boolean = () => true
): Promise<void> {
  if (!isCurrent()) return
  await openWorkspace(path)
  if (!isCurrent()) return
  void Promise.resolve(refreshRecent()).catch(() => undefined)
}

export function WelcomePage(): React.ReactElement {
  const open = useWorkspace((s) => s.open)
  const createAndOpen = useWorkspace((s) => s.createAndOpen)
  const error = useWorkspace((s) => s.error)
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [parentDir, setParentDir] = useState('')
  const [busy, setBusy] = useState(false)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [workspaces, setWorkspaces] = useState<WorkspaceListItem[]>([])
  const [workspaceMode, setWorkspaceMode] = useState<'open' | 'import'>('open')
  const [workspacePath, setWorkspacePath] = useState('')
  const [archiveName, setArchiveName] = useState('')
  const [workspaceLoadError, setWorkspaceLoadError] = useState<string | null>(null)
  const [workspacePickerError, setWorkspacePickerError] = useState<string | null>(null)
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [workspaceActionBusy, setWorkspaceActionBusy] = useState(false)
  const [workspaceApiReady, setWorkspaceApiReady] = useState(false)
  const workspaceLoadId = useRef(0)
  const workspaceLoadingRequest = useRef<{ loadId: number; configKey: string } | null>(null)
  const workspaceRequestSequence = useRef(0)
  const workspaceRequest = useRef<{ requestId: string; controller: AbortController } | null>(null)
  const archiveInput = useRef<HTMLInputElement>(null)
  const isWeb = isWebPlatform()
  const [mode, setMode] = useState<'local' | 'remote'>(isWeb ? 'remote' : 'local')
  const [serviceUrl, setServiceUrl] = useState('')
  const [serviceKey, setServiceKey] = useState('')
  const [serviceError, setServiceError] = useState<string | null>(null)
  const [serviceConnecting, setServiceConnecting] = useState(false)
  const [recentLoadConfig, setRecentLoadConfig] = useState<{
    mode: 'local' | 'remote'
    serviceRoot: string
    serviceKey: string
    serviceConfigSubmitted: boolean
  }>({
    mode: isWeb ? 'remote' : 'local',
    serviceRoot: '',
    serviceKey: '',
    serviceConfigSubmitted: true
  })
  const [recentItems, setRecentItems] = useState<WorkspaceListItem[]>([])
  const [recentItemsConfigKey, setRecentItemsConfigKey] = useState<string | null>(null)
  const [recentLoading, setRecentLoading] = useState(false)
  const [recentError, setRecentError] = useState<string | null>(null)
  const [recentOpeningPath, setRecentOpeningPath] = useState<string | null>(null)
  const recentOpeningRequestId = useRef(0)
  const recentWorkspaceRequest = useRef<{ requestId: string; controller: AbortController } | null>(null)
  const [recentLoadGeneration, setRecentLoadGeneration] = useState(0)
  const [deployOpen, setDeployOpen] = useState(false)
  const [targets, setTargets] = useState<DeployTargetPublic[]>([])
  const [targetNotice, setTargetNotice] = useState<Record<string, string>>({})
  const [targetBusy, setTargetBusy] = useState<string | null>(null)
  const [logs, setLogs] = useState<{ title: string; text: string } | null>(null)
  const isAndroid = typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.())
  const localApiRef = useRef<StoryFabricApi | null>(null)
  const recentLoadId = useRef(0)
  const mountedRef = useRef(false)
  if (!localApiRef.current && !isWeb) localApiRef.current = getLocalPlatformApi()

  const currentServiceRoot = !isWeb && mode === 'remote' ? serviceUrl.trim().replace(/\/+$/, '') : ''
  const currentServiceKey = !isWeb && mode === 'remote' ? serviceKey.trim() : ''
  const currentConfigKey = createRecentConfigKey(isWeb, isAndroid, mode, currentServiceRoot, currentServiceKey)
  const recentConfigKey = createRecentConfigKey(
    isWeb,
    isAndroid,
    recentLoadConfig.mode,
    recentLoadConfig.serviceRoot,
    recentLoadConfig.serviceKey
  )
  const currentConfigKeyRef = useRef(currentConfigKey)
  currentConfigKeyRef.current = currentConfigKey
  const recentConfigKeyRef = useRef(recentConfigKey)
  recentConfigKeyRef.current = recentConfigKey
  const serviceConnectionRequestId = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      workspaceLoadId.current += 1
      recentLoadId.current += 1
      recentOpeningRequestId.current += 1
      workspaceRequest.current?.controller.abort()
      const requestId = workspaceRequest.current?.requestId
      if (requestId) void getPlatformApi().cancelWorkspaceRequest?.(requestId)?.catch(() => undefined)
      const recentRequestId = recentWorkspaceRequest.current?.requestId
      recentWorkspaceRequest.current?.controller.abort()
      if (recentRequestId) void getPlatformApi().cancelWorkspaceRequest?.(recentRequestId)?.catch(() => undefined)
    }
  }, [])

  const loadRecentWorkspaces = useCallback(async (expectedConfigKey: string = recentConfigKey): Promise<void> => {
    if (!mountedRef.current || recentConfigKeyRef.current !== expectedConfigKey || currentConfigKeyRef.current !== expectedConfigKey) return
    const loadId = ++recentLoadId.current
    const isCurrent = (): boolean =>
      mountedRef.current &&
      recentLoadId.current === loadId &&
      recentConfigKeyRef.current === expectedConfigKey &&
      currentConfigKeyRef.current === expectedConfigKey

    if (!isCurrent()) return
    setRecentError(null)

    if (!shouldAutoLoadRecentWorkspaces(isWeb, recentLoadConfig.mode, recentLoadConfig.serviceConfigSubmitted)) {
      setRecentItems([])
      setRecentItemsConfigKey(null)
      setRecentLoading(false)
      return
    }

    setRecentItems([])
    setRecentItemsConfigKey(null)
    setRecentLoading(true)
    try {
      let recentApi: StoryFabricApi
      if (isWeb) {
        recentApi = getPlatformApi()
      } else if (recentLoadConfig.mode === 'remote') {
        const token = await loginRemote(recentLoadConfig.serviceRoot, recentLoadConfig.serviceKey)
        if (!isCurrent()) return
        const remote = new HttpPlatformApi(fetch, recentLoadConfig.serviceRoot, { kind: 'bearer', token })
        if (!isCurrent()) return
        installPlatformApi(remote)
        recentApi = remote
      } else {
        recentApi = localApiRef.current ?? getPlatformApi()
        if (!isCurrent()) return
        installPlatformApi(recentApi)
      }

      const items = await recentApi.listRecentWorkspaces()
      if (!isCurrent()) return
      setRecentItems(items)
      setRecentItemsConfigKey(expectedConfigKey)
    } catch (err) {
      if (!isCurrent()) return
      setRecentItems([])
      setRecentItemsConfigKey(null)
      setRecentError(err instanceof Error ? err.message : String(err))
    } finally {
      if (isCurrent()) setRecentLoading(false)
    }
  }, [isAndroid, isWeb, recentConfigKey, recentLoadConfig])

  useEffect(() => {
    const expectedConfigKey = recentConfigKey
    const requestId = serviceConnectionRequestId.current
    void loadRecentWorkspaces(expectedConfigKey).finally(() => {
      if (requestId !== 0 && serviceConnectionRequestId.current === requestId) setServiceConnecting(false)
    })
    return () => {
      recentLoadId.current += 1
    }
  }, [isAndroid, isWeb, recentLoadGeneration, loadRecentWorkspaces, recentConfigKey])

  useEffect(() => {
    const request = recentWorkspaceRequest.current
    request?.controller.abort()
    if (request) void getPlatformApi().cancelWorkspaceRequest?.(request.requestId)?.catch(() => undefined)
    recentWorkspaceRequest.current = null
    recentOpeningRequestId.current += 1
    setRecentOpeningPath(null)
    if (recentItemsConfigKey !== currentConfigKey) {
      recentLoadId.current += 1
      setRecentItems([])
      setRecentItemsConfigKey(null)
      setRecentLoading(false)
      setRecentError(null)
    }
  }, [currentConfigKey])

  const reloadTargets = useCallback(async (): Promise<void> => {
    try {
      setTargets(await api.deployListTargets())
    } catch {
      // 非桌面端不支持远程部署，静默忽略
      setTargets([])
    }
  }, [])

  useEffect(() => {
    if (SERVER_DEPLOYMENT_ENABLED) void reloadTargets()
  }, [reloadTargets])

  const checkUpdate = async (target: DeployTargetPublic): Promise<void> => {
    setTargetBusy(target.id)
    setTargetNotice((prev) => ({ ...prev, [target.id]: '检查中…' }))
    try {
      const result = await api.deployTestConnection({
        targetId: target.id,
        host: target.host,
        port: target.port,
        username: target.username
      })
      const installed = result.probe.installedImage?.split(':')[1]
      setTargetNotice((prev) => ({
        ...prev,
        [target.id]:
          installed === result.bundleVersion
            ? `已是最新（${result.bundleVersion}）`
            : `有新版本可更新：${installed ?? '未知'} → ${result.bundleVersion}`
      }))
    } catch (err) {
      setTargetNotice((prev) => ({ ...prev, [target.id]: err instanceof Error ? err.message : String(err) }))
    } finally {
      setTargetBusy(null)
    }
  }

  const runUpdate = async (target: DeployTargetPublic): Promise<void> => {
    setTargetBusy(target.id)
    setTargetNotice((prev) => ({ ...prev, [target.id]: '更新中…' }))
    try {
      const result = await api.deployUpdate(target.id)
      if (result.ok) {
        // 更新不会换密钥，但如果本地服务地址就是这台机器，顺手同步一下密钥
        const expected = `http://${target.host}:${target.servicePort}`
        if (result.accessKey && serviceUrl.trim().replace(/\/+$/, '') === expected) setServiceKey(result.accessKey)
      }
      setTargetNotice((prev) => ({
        ...prev,
        [target.id]: result.ok ? `已更新到 ${result.version}` : result.error ?? '更新失败'
      }))
      await reloadTargets()
    } catch (err) {
      setTargetNotice((prev) => ({ ...prev, [target.id]: err instanceof Error ? err.message : String(err) }))
    } finally {
      setTargetBusy(null)
    }
  }

  const showLogs = async (target: DeployTargetPublic): Promise<void> => {
    setTargetBusy(target.id)
    try {
      setLogs({ title: `${target.label} · 容器日志`, text: await api.deployLogs(target.id) })
    } catch (err) {
      setTargetNotice((prev) => ({ ...prev, [target.id]: err instanceof Error ? err.message : String(err) }))
    } finally {
      setTargetBusy(null)
    }
  }

  const removeTarget = async (target: DeployTargetPublic): Promise<void> => {
    if (!window.confirm(`卸载 ${target.label} 上的 StoryFabric？\n容器与镜像会被删除，数据目录 ${target.installDir}/data 会保留。`)) return
    setTargetBusy(target.id)
    try {
      await api.deployUninstall(target.id)
      await api.deployDeleteTarget(target.id)
      await reloadTargets()
    } catch (err) {
      setTargetNotice((prev) => ({ ...prev, [target.id]: err instanceof Error ? err.message : String(err) }))
    } finally {
      setTargetBusy(null)
    }
  }

  const pickParent = async (): Promise<void> => {
    const dir = await api.pickFolder()
    if (dir) setParentDir(dir)
  }

  const openCreate = async (): Promise<void> => {
    setCreateOpen(true)
    if (isAndroid) {
      setParentDir('workspaces')
      return
    }
    if (!parentDir) {
      try {
        const docs = await api.getDefaultWorkspaceDir()
        setParentDir(docs)
      } catch {
        /* 取不到文档目录时保持为空，由用户手动选择 */
      }
    }
  }

  const doOpen = async (path: string): Promise<void> => {
    setBusy(true)
    try {
      await open(path)
    } catch {
      /* 错误已写入 store，由界面展示 */
    } finally {
      setBusy(false)
    }
  }

  const openRecentWorkspace = async (path: string): Promise<void> => {
    const expectedConfigKey = recentItemsConfigKey
    if (expectedConfigKey === null || expectedConfigKey !== currentConfigKey) return
    const requestId = ++recentOpeningRequestId.current
    const request = {
      requestId: `welcome-recent-${Date.now().toString(36)}-${requestId}`,
      controller: new AbortController()
    }
    recentWorkspaceRequest.current = request
    const requestGuard = createWorkspaceOpenRequestGuard(
      expectedConfigKey,
      requestId,
      () => mountedRef.current,
      () => currentConfigKeyRef.current,
      () => recentOpeningRequestId.current
    )
    setRecentOpeningPath(path)
    setRecentError(null)
    try {
      await openRecentWorkspaceThenRefresh(
        path,
        (workspacePath) => open(workspacePath, requestGuard.isCurrent, { signal: request.controller.signal, requestId: request.requestId }),
        loadRecentWorkspaces,
        requestGuard.isCurrent
      )
    } catch (err) {
      if (!requestGuard.isCurrent()) return
      useWorkspace.setState({ error: null })
      setRecentError(err instanceof Error ? err.message : String(err))
    } finally {
      if (requestGuard.isCurrent()) {
        setRecentOpeningPath(null)
        if (recentWorkspaceRequest.current === request) recentWorkspaceRequest.current = null
      }
    }
  }

  const connectService = (): void => {
    if (serviceConnecting) return
    const root = serviceUrl.trim().replace(/\/+$/, '')
    const key = serviceKey.trim()
    if (!root) {
      setServiceError('请输入服务地址')
      return
    }
    if (!key) {
      setServiceError('请输入访问密钥')
      return
    }
    serviceConnectionRequestId.current += 1
    setServiceConnecting(true)
    setServiceError(null)
    setRecentLoadConfig({ mode: 'remote', serviceRoot: root, serviceKey: key, serviceConfigSubmitted: true })
    setRecentLoadGeneration((generation) => generation + 1)
  }

  const resetWorkspacePicker = (): void => {
    const request = workspaceRequest.current
    request?.controller.abort()
    if (request) void getPlatformApi().cancelWorkspaceRequest?.(request.requestId)?.catch(() => undefined)
    workspaceRequest.current = null
    workspaceLoadId.current += 1
    setWorkspaces([])
    setWorkspaceMode('open')
    setWorkspacePath('')
    setArchiveName('')
    setWorkspaceLoadError(null)
    setWorkspacePickerError(null)
    setWorkspaceLoading(false)
    workspaceLoadingRequest.current = null
    setWorkspaceActionBusy(false)
    setWorkspaceApiReady(false)
    useWorkspace.setState({ error: null })
    if (archiveInput.current) archiveInput.current.value = ''
  }

  const closeWorkspacePicker = (): void => {
    setWorkspaceOpen(false)
    resetWorkspacePicker()
  }

  const handleWorkspacePickerOpenChange = (open: boolean): void => {
    if (open) {
      setWorkspaceOpen(true)
      return
    }

    if (!shouldCloseWorkspacePicker(open, workspaceLoading, workspaceActionBusy)) return
    closeWorkspacePicker()
  }

  const setWorkspacePickerFailure = (err: unknown): void => {
    const message = err instanceof Error ? err.message : String(err)
    setWorkspacePickerError(message)
    useWorkspace.setState({ error: message })
  }

  const requireWorkspaceApi = (): void => {
    if (mode === 'remote' && !workspaceApiReady) {
      throw new Error(workspaceLoadError ?? '服务尚未连接完成，请稍候再试')
    }
  }

  const browseWorkspaceFolder = async (): Promise<void> => {
    const path = await api.pickFolder()
    if (path) setWorkspacePath(path)
  }

  const openTypedWorkspace = async (): Promise<void> => {
    const generation = workspaceLoadId.current
    const requestGuard = createWorkspaceOpenRequestGuard(
      currentConfigKey,
      generation,
      () => mountedRef.current,
      () => currentConfigKeyRef.current,
      () => workspaceLoadId.current
    )
    const path = workspacePath.trim()
    if (!path) return
    const request = workspaceRequest.current
    const options = request ? { signal: request.controller.signal, requestId: request.requestId } : undefined
    setWorkspaceActionBusy(true)
    setWorkspacePickerError(null)
    try {
      if (!requestGuard.isCurrent()) return
      requireWorkspaceApi()
      const platform = getPlatformApi()
      if (!requestGuard.isCurrent()) return
      const summary = options ? await platform.openWorkspaceByPath(path, options) : await platform.openWorkspaceByPath(path)
      if (!requestGuard.isCurrent()) return
      useWorkspace.setState({ status: 'ready', summary, error: null })
      closeWorkspacePicker()
    } catch (err) {
      if (requestGuard.isCurrent()) setWorkspacePickerFailure(err)
    } finally {
      if (requestGuard.isCurrent()) setWorkspaceActionBusy(false)
    }
  }

  const importSelectedArchive = async (file: File): Promise<void> => {
    const generation = workspaceLoadId.current
    const requestGuard = createWorkspaceOpenRequestGuard(
      currentConfigKey,
      generation,
      () => mountedRef.current,
      () => currentConfigKeyRef.current,
      () => workspaceLoadId.current
    )
    const isCurrent = requestGuard.isCurrent
    const request = workspaceRequest.current
    const options = request ? { signal: request.controller.signal, requestId: request.requestId } : undefined
    setWorkspaceActionBusy(true)
    setWorkspacePickerError(null)
    try {
      const bytes = await readWorkspaceArchiveFile(file)
      if (!isCurrent()) return
      requireWorkspaceApi()
      let target: WorkspaceImportTarget | undefined = { name: archiveName.trim() || undefined }
      if (mode === 'local' && !isAndroid && !isWeb) {
        if (!isCurrent()) return
        const parentDir = await api.pickFolder()
        if (!isCurrent()) return
        if (!parentDir) throw new Error('请选择导入工作区的目标文件夹')
        target = { parentDir, name: archiveName.trim() || undefined }
      }
      if (!isCurrent()) return
      if (options) await useWorkspace.getState().importArchive(bytes, file.name, target, isCurrent, options)
      else await useWorkspace.getState().importArchive(bytes, file.name, target, isCurrent)
      if (!isCurrent()) return
      closeWorkspacePicker()
    } catch (err) {
      if (isCurrent()) setWorkspacePickerFailure(err)
    } finally {
      if (isCurrent()) {
        setWorkspaceActionBusy(false)
        if (archiveInput.current) archiveInput.current.value = ''
      }
    }
  }

  const openWorkspacePicker = async (): Promise<void> => {
    resetWorkspacePicker()
    const loadId = workspaceLoadId.current
    const expectedConfigKey = currentConfigKey
    const requestGuard = createWorkspaceOpenRequestGuard(
      expectedConfigKey,
      loadId,
      () => mountedRef.current,
      () => currentConfigKeyRef.current,
      () => workspaceLoadId.current
    )
    const isCurrent = requestGuard.isCurrent
    const requestId = `welcome-workspace-${Date.now().toString(36)}-${++workspaceRequestSequence.current}`
    workspaceRequest.current = { requestId, controller: new AbortController() }
    setWorkspaceOpen(true)
    workspaceLoadingRequest.current = { loadId, configKey: expectedConfigKey }
    setWorkspaceLoading(true)
    if (isWeb) {
      setWorkspaceApiReady(true)
      try {
        const list = await api.listWorkspaces()
        if (isCurrent()) setWorkspaces(list)
      } catch (err) {
        if (isCurrent()) setWorkspaceLoadError(err instanceof Error ? err.message : String(err))
      } finally {
        if (shouldClearWorkspaceLoading(
          mountedRef.current,
          expectedConfigKey,
          workspaceLoadingRequest.current?.configKey ?? null,
          loadId,
          workspaceLoadingRequest.current?.loadId ?? null
        )) {
          workspaceLoadingRequest.current = null
          setWorkspaceLoading(false)
        }
      }
      return
    }
    if (mode === 'remote') {
      try {
        const root = serviceUrl.trim().replace(/\/+$/, '')
        const token = await loginRemote(root, serviceKey.trim())
        if (!isCurrent()) return
        const remote = new HttpPlatformApi(fetch, root, { kind: 'bearer', token })
        if (!isCurrent()) return
        installPlatformApi(remote)
        setWorkspaceApiReady(true)
        const list = await remote.listWorkspaces()
        if (isCurrent()) setWorkspaces(list)
      } catch (err) {
        if (isCurrent()) setWorkspaceLoadError(err instanceof Error ? err.message : String(err))
      } finally {
        if (shouldClearWorkspaceLoading(
          mountedRef.current,
          expectedConfigKey,
          workspaceLoadingRequest.current?.configKey ?? null,
          loadId,
          workspaceLoadingRequest.current?.loadId ?? null
        )) {
          workspaceLoadingRequest.current = null
          setWorkspaceLoading(false)
        }
      }
      return
    }
    try {
      if (localApiRef.current && isCurrent()) installPlatformApi(localApiRef.current)
      if (isCurrent()) setWorkspaceApiReady(true)
      const list = await getPlatformApi().listWorkspaces()
      if (isCurrent()) setWorkspaces(list)
    } catch (err) {
      if (isCurrent()) setWorkspaceLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      if (shouldClearWorkspaceLoading(
        mountedRef.current,
        expectedConfigKey,
        workspaceLoadingRequest.current?.configKey ?? null,
        loadId,
        workspaceLoadingRequest.current?.loadId ?? null
      )) {
        workspaceLoadingRequest.current = null
        setWorkspaceLoading(false)
      }
    }
  }

  const doCreate = async (): Promise<void> => {
    if (!name.trim() || (mode === 'local' && !isAndroid && !parentDir)) return
    setBusy(true)
    try {
      if (mode === 'remote') {
        if (!isWeb) {
          const root = serviceUrl.trim().replace(/\/+$/, '')
          const token = await loginRemote(root, serviceKey.trim())
          installPlatformApi(new HttpPlatformApi(fetch, root, { kind: 'bearer', token }))
        }
        await createAndOpen('', name.trim())
      } else {
        await createAndOpen(parentDir, name.trim())
      }
      setCreateOpen(false)
    } catch {
      /* 错误已写入 store */
    } finally {
      setBusy(false)
    }
  }

  if (SERVER_DEPLOYMENT_ENABLED && deployOpen) {
    return (
      <DeployWizard
        onClose={() => setDeployOpen(false)}
        onDone={({ url, accessKey }) => {
          setMode('remote')
          setServiceUrl(url)
          setServiceKey(accessKey)
          setRecentLoadConfig({ mode: 'remote', serviceRoot: url.trim().replace(/\/+$/, ''), serviceKey: accessKey.trim(), serviceConfigSubmitted: true })
          setDeployOpen(false)
          void reloadTargets()
        }}
      />
    )
  }

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-app p-4 sm:p-8">
      <div className="w-full max-w-6xl">
        <div className="mx-auto mb-6 flex min-w-0 max-w-5xl items-center justify-center gap-4 sm:mb-10 sm:gap-5">
          <BrandMark variant="flat" size={56} className="shrink-0 rounded-[14px] drop-shadow-lg shadow-accent/25 sm:h-16 sm:w-16" />
          <div className="min-w-0 max-w-3xl">
            <div className="flex min-w-0 items-baseline gap-3">
              <h1 className="truncate text-2xl font-bold tracking-wide sm:text-3xl">织章</h1>
              <p className="truncate text-xs font-medium tracking-[0.16em] text-muted sm:text-sm sm:tracking-[0.2em]">STORYFABRIC</p>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">依托智能体的小说创作工作台 —— 人物、关系、大纲、事件脉络与正文，一个工作区全部搞定</p>
          </div>
        </div>

        <Card className="grid min-w-0 gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:p-6">
          <div className="min-w-0">
          {!isWeb && SERVER_DEPLOYMENT_ENABLED && (
            <div className="mb-4 grid grid-cols-2 rounded-lg border border-line p-1 text-sm">
              <button type="button" aria-pressed={mode === 'local'} onClick={() => { serviceConnectionRequestId.current += 1; setServiceConnecting(false); setMode('local'); setServiceError(null); setRecentLoadConfig({ mode: 'local', serviceRoot: '', serviceKey: '', serviceConfigSubmitted: true }); if (localApiRef.current) installPlatformApi(localApiRef.current) }} className={`rounded-md px-3 py-2 ${mode === 'local' ? 'bg-accent-soft text-accent' : 'text-muted'}`}>本地</button>
              <button type="button" aria-pressed={mode === 'remote'} onClick={() => { serviceConnectionRequestId.current += 1; setServiceConnecting(false); setMode('remote'); setRecentError(null); setRecentItems([]); setRecentLoadConfig({ mode: 'remote', serviceRoot: '', serviceKey: '', serviceConfigSubmitted: false }) }} className={`rounded-md px-3 py-2 ${mode === 'remote' ? 'bg-accent-soft text-accent' : 'text-muted'}`}>服务</button>
            </div>
          )}
          {SERVER_DEPLOYMENT_ENABLED && mode === 'remote' && !isWeb && (
            <form className="mb-4 space-y-2" onSubmit={(event) => { event.preventDefault(); connectService() }}>
              <label htmlFor="service-url" className="sr-only">服务地址</label>
              <Input id="service-url" value={serviceUrl} onChange={(e) => setServiceUrl(e.target.value)} placeholder="服务地址，例如 https://example.com:8787" aria-describedby={serviceError ? 'service-error' : undefined} aria-invalid={Boolean(serviceError)} />
              <label htmlFor="service-key" className="sr-only">访问密钥</label>
              <Input id="service-key" type="password" value={serviceKey} onChange={(e) => setServiceKey(e.target.value)} placeholder="访问密钥" aria-describedby={serviceError ? 'service-error' : undefined} aria-invalid={Boolean(serviceError)} />
              <Button type="submit" size="sm" variant="outline" loading={serviceConnecting} disabled={serviceConnecting}>连接服务</Button>
              {!isAndroid && (
                <Button type="button" size="sm" variant="outline" onClick={() => setDeployOpen(true)}>
                  <Server size={13} /> 安装到服务器
                </Button>
              )}
              {serviceError && <div id="service-error" role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{serviceError}</div>}
            </form>
          )}
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button variant="primary" className="flex-1 justify-center" onClick={() => void openWorkspacePicker()} loading={busy || workspaceLoading}>
              <FolderOpen size={16} /> 打开其他工作区
            </Button>
            <Button variant="outline" className="flex-1 justify-center" onClick={() => void openCreate()} disabled={busy}>
              <FolderPlus size={16} /> 创建新工作区
            </Button>
          </div>

          {error && <div className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</div>}

          {SERVER_DEPLOYMENT_ENABLED && mode === 'remote' && !isWeb && targets.length > 0 && (
            <div className="mt-5 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
                <Server size={13} /> 已部署的服务器
              </div>
              {targets.map((target) => (
                <div key={target.id} className="rounded-lg border border-line p-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{target.label}</span>
                    <span className="shrink-0 text-xs text-faint">
                      {target.host}:{target.servicePort} · {target.installedVersion ?? '未知版本'}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
                    {target.lastStatus === 'ok' && <span className="text-ok">上次部署成功</span>}
                    {target.lastStatus === 'failed' && <span className="text-danger">上次部署失败</span>}
                    {target.passwordStorage === 'plain' && <span className="text-danger">密码为降级明文存储</span>}
                    {target.isRoot === false && <span>非 root（使用 sudo）</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button size="sm" variant="ghost" loading={targetBusy === target.id} onClick={() => void checkUpdate(target)}>
                      检查更新
                    </Button>
                    <Button size="sm" variant="soft" loading={targetBusy === target.id} onClick={() => void runUpdate(target)}>
                      更新
                    </Button>
                    <Button size="sm" variant="ghost" loading={targetBusy === target.id} onClick={() => void showLogs(target)}>
                      查看日志
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger hover:text-danger"
                      loading={targetBusy === target.id}
                      onClick={() => void removeTarget(target)}
                    >
                      卸载
                    </Button>
                  </div>
                  {targetNotice[target.id] && <p className="mt-2 text-[11px] text-muted">{targetNotice[target.id]}</p>}
                </div>
              ))}
            </div>
          )}

          </div>
          <div className="min-w-0 border-t border-line pt-6 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <RecentWorkspaceList
              items={recentItemsConfigKey === currentConfigKey ? recentItems : []}
              loading={recentItemsConfigKey === currentConfigKey ? recentLoading : false}
              error={recentItemsConfigKey === currentConfigKey ? recentError : null}
              openingPath={recentOpeningPath}
              onOpen={openRecentWorkspace}
              onRetry={loadRecentWorkspaces}
            />
          </div>
        </Card>

        <p className="mt-6 text-center text-xs text-faint">
          工作区就是一个普通文件夹：所有设定与正文都以 Markdown 存放，随时可以用其他编辑器打开
        </p>
      </div>

      <Modal open={workspaceOpen} onOpenChange={handleWorkspacePickerOpenChange} title="打开工作区" description="打开已有文件夹，或导入压缩包新建工作区">
        {workspaceLoadError && <div className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{workspaceLoadError}</div>}
        <div className="grid grid-cols-2 rounded-lg border border-line p-1 text-sm">
          <button type="button" onClick={() => { setWorkspaceMode('open'); setWorkspacePickerError(null); useWorkspace.setState({ error: null }) }} className={`rounded-md px-3 py-2 ${workspaceMode === 'open' ? 'bg-accent-soft text-accent' : 'text-muted'}`}>打开已有文件夹</button>
          <button type="button" onClick={() => { setWorkspaceMode('import'); setWorkspacePickerError(null); useWorkspace.setState({ error: null }) }} className={`rounded-md px-3 py-2 ${workspaceMode === 'import' ? 'bg-accent-soft text-accent' : 'text-muted'}`}>导入压缩包</button>
        </div>

        {workspaceMode === 'open' ? (
          <div className="space-y-4">
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Input value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} placeholder={isAndroid ? '输入应用内部路径，例如 workspaces/星海拾遗' : '粘贴工作区路径…'} className="min-w-0 flex-1" />
              {mode === 'local' && !isWeb && !isAndroid && <Button onClick={() => void browseWorkspaceFolder()} className="shrink-0">浏览文件夹</Button>}
            </div>
            <Button variant="primary" onClick={() => void openTypedWorkspace()} disabled={!workspacePath.trim()} loading={workspaceActionBusy} className="w-full justify-center">打开路径</Button>
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted"><History size={13} /> 可直接打开的工作区</div>
              {workspaces.length === 0 ? (
                <div className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-sm text-muted">还没有可打开的工作区，请粘贴路径或先创建一个。</div>
              ) : (
                <div className="space-y-2">
                  {workspaces.map((item) => (
                    <button
                      key={item.path}
                      disabled={busy || workspaceLoading || workspaceActionBusy}
                      className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-line px-3 py-3 text-left hover:bg-elevated transition disabled:opacity-50"
                      onClick={() => { closeWorkspacePicker(); void doOpen(item.path) }}
                    >
                      <BookOpen size={16} className="shrink-0 text-accent" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.name}</span>
                      <span className="shrink-0 text-xs text-faint">{item.chapterCount} 章</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <Field label="新工作区名称（可选）" hint="留空时从归档文件名推导名称">
              <Input value={archiveName} onChange={(event) => setArchiveName(event.target.value)} placeholder="例如：星海拾遗" />
            </Field>
            <input
              ref={archiveInput}
              type="file"
              accept={WORKSPACE_ARCHIVE_ACCEPT}
              className="hidden"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                if (file) void importSelectedArchive(file)
              }}
            />
            <Button variant="primary" onClick={() => archiveInput.current?.click()} loading={workspaceActionBusy} className="w-full justify-center">浏览压缩包并导入</Button>
          </div>
        )}
        {workspacePickerError && <div className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{workspacePickerError}</div>}
      </Modal>

      <Modal open={Boolean(logs)} onOpenChange={() => setLogs(null)} title={logs?.title ?? '容器日志'}>
        <pre className="max-h-80 overflow-auto rounded-lg bg-app p-2 text-[11px] leading-4">{logs?.text || '（空）'}</pre>
      </Modal>

      <Modal open={createOpen} onOpenChange={setCreateOpen} title="创建新工作区" description={mode === 'remote' ? '将在当前服务的数据目录内创建一个新的托管工作区' : isAndroid ? '工作区将保存在应用内部，可通过 ZIP 导入/导出' : '将在所选文件夹内创建一个以小说名命名的新文件夹'}>
        <div className="space-y-4">
          <Field label="小说名称 *">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：星海拾遗" autoFocus />
          </Field>
          {mode === 'local' && <Field label={isAndroid ? '存放位置' : '存放位置（默认为文档目录）'} hint={isAndroid ? 'Android 应用内部存储（无需申请文件夹权限）' : `创建后工作区路径形如 ${parentDir ? parentDir + '\\' : '文档目录\\'}<小说名>`}>
            <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={parentDir} onChange={(e) => setParentDir(e.target.value)} placeholder="输入或选择存放文件夹…" className="min-w-0 flex-1" />
              {!isAndroid && <Button onClick={() => void pickParent()} className="shrink-0 whitespace-nowrap">
                浏览
              </Button>}
            </div>
          </Field>}
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={() => void doCreate()} loading={busy} disabled={!name.trim() || (mode === 'local' && !isAndroid && !parentDir) || (mode === 'remote' && !isWeb && (!serviceUrl.trim() || !serviceKey.trim()))}>
              创建并打开
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
