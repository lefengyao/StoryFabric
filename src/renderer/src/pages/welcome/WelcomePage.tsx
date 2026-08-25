import { BookOpen, FolderOpen, FolderPlus, History, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, Field, Input } from '../../components/ui/primitives'
import { Modal } from '../../components/ui/modal'
import { api } from '../../lib/api'
import { useSettings } from '../../stores/settingsStore'
import { useWorkspace } from '../../stores/workspaceStore'

export function WelcomePage(): React.ReactElement {
  const open = useWorkspace((s) => s.open)
  const createAndOpen = useWorkspace((s) => s.createAndOpen)
  const error = useWorkspace((s) => s.error)
  const settings = useSettings((s) => s.settings)
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [parentDir, setParentDir] = useState('')
  const [busy, setBusy] = useState(false)

  const pickParent = async (): Promise<void> => {
    const dir = await api.pickFolder()
    if (dir) setParentDir(dir)
  }

  const doOpen = async (path?: string): Promise<void> => {
    setBusy(true)
    try {
      if (path) await open(path)
      else {
        const dir = await api.pickFolder()
        if (dir) await open(dir)
      }
    } catch {
      /* 错误已写入 store，由界面展示 */
    } finally {
      setBusy(false)
    }
  }

  const doCreate = async (): Promise<void> => {
    if (!name.trim() || !parentDir) return
    setBusy(true)
    try {
      await createAndOpen(parentDir, name.trim())
      setCreateOpen(false)
    } catch {
      /* 错误已写入 store */
    } finally {
      setBusy(false)
    }
  }

  const recent = settings?.recentWorkspaces ?? []

  return (
    <div className="flex h-full items-center justify-center bg-app p-8">
      <div className="w-full max-w-xl">
        <div className="mb-10 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-accent-fg shadow-lg shadow-accent/25">
            <Sparkles size={26} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">StoryFabric</h1>
          <p className="mt-2 text-sm text-muted">依托智能体的小说创作工作台 —— 人物、关系、大纲、事件脉络与正文，一个工作区全部搞定</p>
        </div>

        <Card className="p-5">
          <div className="flex gap-3">
            <Button variant="primary" className="flex-1 justify-center" onClick={() => void doOpen()} loading={busy}>
              <FolderOpen size={16} /> 打开工作区文件夹
            </Button>
            <Button variant="outline" className="flex-1 justify-center" onClick={() => setCreateOpen(true)} disabled={busy}>
              <FolderPlus size={16} /> 创建新工作区
            </Button>
          </div>

          {error && <div className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</div>}

          {recent.length > 0 && (
            <div className="mt-5">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
                <History size={13} /> 最近打开
              </div>
              <div className="space-y-1">
                {recent.map((p) => {
                  const label = p.split(/[\\/]/).filter(Boolean).pop() ?? p
                  return (
                    <button
                      key={p}
                      onClick={() => void doOpen(p)}
                      disabled={busy}
                      title={p}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left hover:bg-elevated transition cursor-pointer"
                    >
                      <BookOpen size={14} className="shrink-0 text-faint" />
                      <span className="text-sm">{label}</span>
                      <span className="ml-auto truncate max-w-56 text-xs text-faint">{p}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </Card>

        <p className="mt-6 text-center text-xs text-faint">
          工作区就是一个普通文件夹：所有设定与正文都以 Markdown 存放，随时可以用其他编辑器打开
        </p>
      </div>

      <Modal open={createOpen} onOpenChange={setCreateOpen} title="创建新工作区" description="在指定位置初始化一个新的小说项目文件夹">
        <div className="space-y-4">
          <Field label="工作区名称（小说名）">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：星海拾遗" autoFocus />
          </Field>
          <Field label="存放位置">
            <div className="flex gap-2">
              <Input value={parentDir} onChange={(e) => setParentDir(e.target.value)} placeholder="选择父文件夹…" readOnly />
              <Button onClick={() => void pickParent()}>浏览</Button>
            </div>
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={() => void doCreate()} loading={busy} disabled={!name.trim() || !parentDir}>
              创建并打开
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
