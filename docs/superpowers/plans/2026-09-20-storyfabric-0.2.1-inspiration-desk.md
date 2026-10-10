# StoryFabric 0.2.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Deliver the 0.2.1 generation controls, safe modular Inspiration Desk, three-candidate prose workflow, and chapter metadata refresh fixes without regressing existing writing, Skill, rule, docs, desktop, HTTP, or Android behavior.

**Architecture:** Store global generation preferences separately from provider settings and map their product semantics at the shared LLM boundary. Add an isolated core/inspiration domain with a source catalog, extractors, analysis and publication services; all UI and platform code calls that domain through shared API contracts. Generate prose candidates with no tools and save only from an explicit user action.

**Tech Stack:** TypeScript, Electron/Vite, React 19, Zustand, Vitest, Node FileStore, Capacitor, HTTP RPC/SSE, JSZip, pdfjs-dist.

---

## File map

| Area | Files | Responsibility |
|---|---|---|
| Generation controls | src/shared/agentGeneration.ts, shared types/API, settings stores | Validate and persist product-level preferences. |
| LLM boundary | src/core/llm types/adapters, core agent loop | Send mapped temperature to protocol payloads. |
| Inspiration core | src/shared/inspiration.ts, src/core/inspiration/* | Sources, extraction, analysis and guarded publication. |
| Workspace | workspaceService.ts, migration.ts, archive.ts | Visible inspiration library and portable archives. |
| Platform bridges | shared API/IPC, main/preload/server, HTTP/Android bridges | Same domain operations on every supported client. |
| Renderer | pages/inspiration/*, settings, chat, chapters | Existing visual language and fresh chapter display. |

Keep the existing dirty worktree isolated: stage only the exact paths named in each task. Do not add an MCP server in 0.2.1; the shared InspirationService contract is the future MCP boundary.

### Task 1: Define and persist global generation preferences

**Files:**
- Create: src/shared/agentGeneration.ts
- Create: src/shared/__tests__/agentGeneration.test.ts
- Modify: src/shared/types.ts, src/shared/api.ts
- Modify: src/main/services/settingsService.ts, src/server/settingsStore.ts, src/renderer/src/platform/androidApi.ts
- Test: corresponding settings-service, server-store and Android tests

- [ ] **Step 1: Write failing domain tests.**

~~~ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_AGENT_GENERATION_PREFERENCES, normalizeAgentGenerationPreferences, temperatureForModel } from '../agentGeneration'

describe('agent generation preferences', () => {
  it('defaults and clamps persisted values', () => {
    expect(DEFAULT_AGENT_GENERATION_PREFERENCES).toEqual({ agentTemperature: 70, proseAlternativesEnabled: false })
    expect(normalizeAgentGenerationPreferences({ agentTemperature: 101, proseAlternativesEnabled: 'true' }))
      .toEqual({ agentTemperature: 100, proseAlternativesEnabled: false })
  })
  it('maps a higher product value to a lower raw model temperature', () => {
    expect(temperatureForModel(0)).toBe(1.2)
    expect(temperatureForModel(70)).toBe(0.5)
    expect(temperatureForModel(100)).toBe(0.2)
  })
})
~~~

- [ ] **Step 2: Run the test to prove the module is missing.**

Run: npx vitest run src/shared/__tests__/agentGeneration.test.ts
Expected: FAIL because src/shared/agentGeneration.ts does not exist.

- [ ] **Step 3: Implement the shared preference contract.**

~~~ts
export interface AgentGenerationPreferences {
  agentTemperature: number
  proseAlternativesEnabled: boolean
}

export const DEFAULT_AGENT_GENERATION_PREFERENCES: AgentGenerationPreferences = {
  agentTemperature: 70,
  proseAlternativesEnabled: false
}

export function normalizeAgentGenerationPreferences(value: unknown): AgentGenerationPreferences {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const raw = typeof input.agentTemperature === 'number' && Number.isFinite(input.agentTemperature)
    ? input.agentTemperature : DEFAULT_AGENT_GENERATION_PREFERENCES.agentTemperature
  return {
    agentTemperature: Math.round(Math.max(0, Math.min(100, raw))),
    proseAlternativesEnabled: input.proseAlternativesEnabled === true
  }
}

export function temperatureForModel(value: number): number {
  return Math.round((1.2 - normalizeAgentGenerationPreferences({ agentTemperature: value }).agentTemperature / 100) * 100) / 100
}
~~~

Add agentGeneration to AppSettings and SettingsPatch. Add defaults and normalization in the Electron, server and Android settings stores. Add the normalized object to the core AgentSettings provider returned by each platform. Never put it in per-model ModelSettings.

- [ ] **Step 4: Add legacy and write-round-trip tests.**

~~~ts
it('adds defaults to legacy settings', async () => {
  await writeFile(file, JSON.stringify({ providers: [], customPrompt: 'legacy' }))
  expect((await service.load()).agentGeneration).toEqual({ agentTemperature: 70, proseAlternativesEnabled: false })
})

it('persists normalized generation preferences', async () => {
  await service.update({ agentGeneration: { agentTemperature: -1, proseAlternativesEnabled: true } })
  expect((await service.load()).agentGeneration).toEqual({ agentTemperature: 0, proseAlternativesEnabled: true })
})
~~~

- [ ] **Step 5: Verify and commit the foundation.**

Run: npx vitest run src/shared/__tests__/agentGeneration.test.ts src/main/services/__tests__/settingsService.test.ts src/server/__tests__/settingsStore.test.ts src/renderer/src/platform/__tests__/androidApi.test.ts
Expected: PASS.

~~~powershell
git add src/shared/agentGeneration.ts src/shared/__tests__/agentGeneration.test.ts src/shared/types.ts src/shared/api.ts src/main/services/settingsService.ts src/main/services/__tests__/settingsService.test.ts src/server/settingsStore.ts src/server/__tests__/settingsStore.test.ts src/renderer/src/platform/androidApi.ts src/renderer/src/platform/__tests__/androidApi.test.ts
git commit -m "feat: persist agent generation preferences"
~~~

### Task 2: Map preferences into every LLM adapter

**Files:**
- Modify: src/core/llm/types.ts, openaiAdapter.ts, anthropicAdapter.ts, geminiAdapter.ts
- Modify: src/core/agent/agentLoop.ts, src/main/agent/agentLoop.ts
- Create: src/core/llm/__tests__/temperature.test.ts
- Modify: src/core/agent/__tests__/agentLoop.test.ts

- [ ] **Step 1: Write a protocol serialization test.**

~~~ts
it.each([
  ['openai', { temperature: 0.5 }],
  ['anthropic', { temperature: 0.5 }],
  ['gemini', { generationConfig: { temperature: 0.5 } }]
])('serializes temperature for %s', async (protocol, expected) => {
  expect(await captureStreamRequest(protocol as Protocol, { ...DEFAULT_MODEL_PARAMS, temperature: 0.5 }))
    .toMatchObject(expected)
})
~~~

- [ ] **Step 2: Run it before extending ModelParams.**

Run: npx vitest run src/core/llm/__tests__/temperature.test.ts
Expected: FAIL because ModelParams lacks temperature.

- [ ] **Step 3: Add the normalized optional parameter and one agent-loop injection point.**

~~~ts
export interface ModelParams {
  reasoning: ReasoningLevel
  reasoningSupport?: boolean
  reasoningMap?: ReasoningMap
  contextTokens: number
  maxOutputTokens: number
  temperature?: number
}

const effectiveSettings: ModelParams = {
  ...resolveModelSettings(provider, req.model),
  temperature: temperatureForModel(settings.agentGeneration.agentTemperature)
}
~~~

OpenAI and Anthropic include params.temperature in their body only when it is defined. Gemini includes it under generationConfig only when defined. Goal planning, goal validation, child agents and orchestration stages must spread the same effective settings rather than recalculate a new value. If a provider rejects temperature, report a non-fatal capability warning and retain the normal response path.

- [ ] **Step 4: Add normal-chat, goal and orchestration assertions.**

~~~ts
expect(adapter.stream).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
  params: expect.objectContaining({ temperature: 0.5 })
}), expect.any(String), expect.any(Object))
~~~

- [ ] **Step 5: Verify and commit.**

Run: npx vitest run src/core/llm/__tests__/temperature.test.ts src/core/agent/__tests__/agentLoop.test.ts src/core/agent/__tests__/modelCallGateway.test.ts
Expected: PASS.

~~~powershell
git add src/core/llm/types.ts src/core/llm/openaiAdapter.ts src/core/llm/anthropicAdapter.ts src/core/llm/geminiAdapter.ts src/core/llm/__tests__/temperature.test.ts src/core/agent/agentLoop.ts src/core/agent/__tests__/agentLoop.test.ts src/main/agent/agentLoop.ts
git commit -m "feat: apply generation temperature to model calls"
~~~

### Task 3: Create portable inspiration workspace storage

**Files:**
- Modify: src/core/workspace/workspaceService.ts, migration.ts, archive.ts
- Create: src/core/workspace/__tests__/inspirationWorkspace.test.ts
- Modify: src/core/workspace/__tests__/workspaceDocs.test.ts, archive.test.ts

- [ ] **Step 1: Write lifecycle and archive tests.**

~~~ts
it('creates inspiration storage and preserves source bytes through archive export/import', async () => {
  await initializeWorkspace(source, '资料库')
  expect(await source.exists('inspiration')).toBe(true)
  await source.writeBytes('inspiration/imported/src_1/reference.pdf', new Uint8Array([37, 80, 68, 70]))
  await source.writeText('.storyfabric/inspiration/catalog.json', '{"version":1,"sources":[]}')
  const archive = await exportWorkspaceArchive(source, '资料库')
  await importWorkspaceArchive(target, archive.bytes)
  expect(await target.readBytes('inspiration/imported/src_1/reference.pdf')).toEqual(new Uint8Array([37, 80, 68, 70]))
})
~~~

- [ ] **Step 2: Run the test.**

Run: npx vitest run src/core/workspace/__tests__/inspirationWorkspace.test.ts
Expected: FAIL because initialization and archive rules do not support inspiration.

- [ ] **Step 3: Add only the visible library and hidden catalog directories.**

~~~ts
await store.ensureDir('docs')
await store.ensureDir('inspiration')
await store.ensureDir('.storyfabric/inspiration')
~~~

Permit inspiration in archive root rules and permit only .storyfabric/inspiration catalog/cache files under the hidden directory. Preserve existing safe path, entry count, per-file and total archive limits. On archive import, write permitted inspiration files as bytes, not UTF-8 text.

- [ ] **Step 4: Cover safety failures.**

~~~ts
await expect(importWorkspaceArchive(target, archiveWith('inspiration/../../outside.txt'))).rejects.toThrow(/非法路径/)
await expect(importWorkspaceArchive(target, archiveWithLargeInspirationFile())).rejects.toThrow(/过大/)
~~~

- [ ] **Step 5: Verify and commit.**

Run: npx vitest run src/core/workspace/__tests__/inspirationWorkspace.test.ts src/core/workspace/__tests__/workspaceDocs.test.ts src/core/workspace/__tests__/archive.test.ts
Expected: PASS.

~~~powershell
git add src/core/workspace/workspaceService.ts src/core/workspace/migration.ts src/core/workspace/archive.ts src/core/workspace/__tests__/inspirationWorkspace.test.ts src/core/workspace/__tests__/workspaceDocs.test.ts src/core/workspace/__tests__/archive.test.ts
git commit -m "feat: add portable inspiration workspace storage"
~~~

### Task 4: Implement source catalog and bounded extractors

**Files:**
- Create: src/shared/inspiration.ts
- Create: src/core/inspiration/sourceCatalog.ts, textExtractors.ts, sourceErrors.ts
- Create: src/core/inspiration/__tests__/sourceCatalog.test.ts, textExtractors.test.ts
- Modify: package.json, package-lock.json

- [ ] **Step 1: Write catalog and extractor tests.**

~~~ts
it('discovers manual library files without changing them and rejects escaping imports', async () => {
  await store.writeText('inspiration/reference/novel.txt', '第一章')
  const catalog = new SourceCatalog(store)
  expect(await catalog.list()).toContainEqual(expect.objectContaining({ relativePath: 'reference/novel.txt', origin: 'library' }))
  await expect(catalog.importBytes({ name: '../escape.txt', bytes: new TextEncoder().encode('x') }))
    .rejects.toMatchObject({ code: 'INVALID_PATH' })
})

it('marks unreadable binary input as unsupported instead of inventing content', async () => {
  const source = await catalog.importBytes({ name: 'bad.pdf', bytes: new Uint8Array([0]) })
  expect((await catalog.extract(source.id)).status).toBe('unsupported')
})
~~~

- [ ] **Step 2: Run the failing catalog tests.**

Run: npx vitest run src/core/inspiration/__tests__/sourceCatalog.test.ts src/core/inspiration/__tests__/textExtractors.test.ts
Expected: FAIL because the core inspiration module is missing.

- [ ] **Step 3: Define shared source contracts and strict failures.**

~~~ts
export type InspirationSourceOrigin = 'library' | 'imported'
export type InspirationExtractionStatus = 'ready' | 'unsupported' | 'failed' | 'too-large'
export interface InspirationSource {
  id: string; relativePath: string; displayName: string; origin: InspirationSourceOrigin
  size: number; extraction: InspirationExtractionStatus; extractedChars?: number; importedAt?: number
}
export interface InspirationImport { name: string; bytes: Uint8Array }
export class InspirationError extends Error {
  constructor(readonly code: 'INVALID_PATH' | 'NOT_FOUND' | 'TOO_LARGE' | 'UNSUPPORTED' | 'SOURCE_CHANGED', message: string) { super(message) }
}
~~~

Implement list, importBytes, removeImported, extract and readExtracted using normalized paths below inspiration. Cap one source at 10 MiB, total raw storage at 30 MiB, extracted text at 500,000 characters and one model slice at 80,000 characters. Store provenance in .storyfabric/inspiration/catalog.json; derived cache belongs in .storyfabric/inspiration/extracted.

- [ ] **Step 4: Add supported extractors and format tests.**

~~~ts
export interface SourceTextExtractor {
  supports(name: string): boolean
  extract(bytes: Uint8Array, name: string): Promise<string>
}
export const extractors: SourceTextExtractor[] = [
  new Utf8TextExtractor(), new DocxTextExtractor(), new PdfTextExtractor()
]
~~~

Use a fatal UTF-8 decoder for txt/md, JSZip XML traversal for DOCX and pdfjs-dist page text content for PDF. Add pdfjs-dist with npm install pdfjs-dist. Encrypted/malformed PDF and malformed DOCX must return UNSUPPORTED and cannot create extracted text.

- [ ] **Step 5: Verify and commit.**

Run: npx vitest run src/core/inspiration/__tests__/sourceCatalog.test.ts src/core/inspiration/__tests__/textExtractors.test.ts src/core/storage/__tests__/fileStore.test.ts
Expected: PASS.

~~~powershell
git add package.json package-lock.json src/shared/inspiration.ts src/core/inspiration/sourceCatalog.ts src/core/inspiration/textExtractors.ts src/core/inspiration/sourceErrors.ts src/core/inspiration/__tests__/sourceCatalog.test.ts src/core/inspiration/__tests__/textExtractors.test.ts
git commit -m "feat: add bounded inspiration source catalog"
~~~

### Task 5: Implement analysis and guarded publication services

**Files:**
- Create: src/core/inspiration/analysisService.ts, artifactPublisher.ts, inspirationService.ts
- Create: src/core/inspiration/__tests__/analysisService.test.ts, artifactPublisher.test.ts, inspirationService.test.ts
- Modify only if needed: src/core/skills/packageValidator.ts, src/core/rules/ruleStore.ts, src/core/workspace/projectDocs.ts

- [ ] **Step 1: Write no-write and deconstruction-boundary tests.**

~~~ts
it('returns cited distillation sections without persisting an artifact', async () => {
  const result = await service.analyze({ kind: 'distill', sourceIds: ['src_1'], goal: '提炼风格' }, context)
  expect(result.sections.some((section) => section.kind === 'style')).toBe(true)
  expect(await store.readText('docs/风格.md')).toBeNull()
})

it('refuses deconstruction publication in the service, not only the UI', async () => {
  await expect(service.publish({ analysisId: 'ana_1', target: 'skill', sectionIds: ['style'] }))
    .rejects.toMatchObject({ code: 'PUBLICATION_FORBIDDEN' })
})
~~~

- [ ] **Step 2: Run the failing service tests.**

Run: npx vitest run src/core/inspiration/__tests__/analysisService.test.ts src/core/inspiration/__tests__/artifactPublisher.test.ts
Expected: FAIL because the analysis/publisher services do not exist.

- [ ] **Step 3: Build structured source-cited analysis with no normal agent tools.**

~~~ts
export type InspirationAnalysisKind = 'name' | 'distill' | 'deconstruct'
export interface InspirationAnalysisRequest { kind: InspirationAnalysisKind; sourceIds: string[]; goal: string; constraints?: string }
export interface InspirationSection {
  id: string; kind: 'names' | 'premise' | 'characters' | 'structure' | 'style' | 'pacing' | 'rules'
  title: string; markdown: string; sourceIds: string[]; publishable: boolean
}
export interface InspirationAnalysisResult { id: string; kind: InspirationAnalysisKind; createdAt: number; sections: InspirationSection[]; warnings: string[] }
~~~

Use map/reduce over bounded extracted slices and require parsed structured output. Every section retains source IDs. Call the model gateway with tools: []; do not import the general agent tool registry or chapter writer. Naming offers candidates/meanings only. Deconstruct sets every section publishable false.

- [ ] **Step 4: Implement preview/confirm publication with existing validators.**

~~~ts
export type InspirationPublicationTarget = 'skill' | 'rules' | 'docs'
export interface PublicationPreview { token: string; target: InspirationPublicationTarget; summary: string; conflicts: string[] }

const preview = await publisher.preview({ analysisId, sectionIds, target: 'docs', documentName: '风格.md' })
const result = await publisher.confirm({ token: preview.token })
~~~

Only publish distill sections marked publishable. Build and validate a ContentPackage before installation, validate RuleLayer content before saving, and publish docs through snapshotProjectDoc/applyProjectDocSnapshot so a changed document never gets silently overwritten. Store source citations and creation time in every published artifact. Reject stale previews, empty selections, invalid doc names and changed sources before write.

- [ ] **Step 5: Verify and commit.**

Run: npx vitest run src/core/inspiration/__tests__/analysisService.test.ts src/core/inspiration/__tests__/artifactPublisher.test.ts src/core/inspiration/__tests__/inspirationService.test.ts src/core/skills/__tests__/packageArchive.test.ts src/core/workspace/__tests__/workspaceDocs.test.ts
Expected: PASS.

~~~powershell
git add src/core/inspiration src/core/skills/packageValidator.ts src/core/rules/ruleStore.ts src/core/workspace/projectDocs.ts
git commit -m "feat: analyze and publish inspiration artifacts"
~~~

### Task 6: Expose the Inspiration Service through platform APIs

**Files:**
- Modify: src/shared/api.ts, src/shared/ipc.ts, src/shared/platformCapabilities.ts
- Modify: src/main/ipc.ts, src/preload/index.ts, src/main/index.ts, src/server/server.ts
- Modify: src/renderer/src/platform/httpApi.ts, androidApi.ts, platformApi.ts
- Create: src/main/__tests__/inspirationIpc.test.ts, src/server/__tests__/inspirationRpc.test.ts, src/renderer/src/platform/__tests__/inspirationParity.test.ts

- [ ] **Step 1: Add an API contract/parity test.**

~~~ts
export interface StoryFabricApi {
  listInspirationSources(): Promise<InspirationSource[]>
  importInspirationFiles(files: InspirationImport[]): Promise<InspirationSource[]>
  inspectInspirationPaths?(paths: string[]): Promise<InspirationExternalCandidate[]>
  importInspirationPaths?(paths: string[]): Promise<InspirationSource[]>
  removeInspirationSource(id: string): Promise<void>
  analyzeInspiration(request: InspirationAnalysisRequest): Promise<InspirationAnalysisResult>
  previewInspirationPublication(request: InspirationPublicationRequest): Promise<PublicationPreview>
  confirmInspirationPublication(token: string): Promise<PublicationResult>
}
~~~

- [ ] **Step 2: Run the adapter tests.**

Run: npx vitest run src/main/__tests__/inspirationIpc.test.ts src/server/__tests__/inspirationRpc.test.ts src/renderer/src/platform/__tests__/inspirationParity.test.ts
Expected: FAIL because the API and IPC channels are absent.

- [ ] **Step 3: Instantiate the core service per workspace in every supported adapter.**

~~~ts
const inspiration = (): InspirationService => new InspirationService({
  store: new NodeFileStore(requireRoot()),
  settings: () => ctx.settings.agentSettings(),
  getAdapter,
  globalSkillLibrary: ctx.agent.globalSkillLibrary()
})

ipcMain.handle(IPC.ListInspirationSources, () => inspiration().listSources())
ipcMain.handle(IPC.AnalyzeInspiration, (_event, request) => inspiration().analyze(request))
~~~

Use equivalent factories for the server and Android FileStore. Report inspiration capability true only after the complete non-native contract is implemented.

- [ ] **Step 4: Add desktop-only external path inspection/import.**

~~~ts
ipcMain.handle(IPC.InspectInspirationPaths, (_event, paths: string[]) => inspectExternalInspirationPaths(paths))
ipcMain.handle(IPC.ImportInspirationPaths, async (_event, paths: string[]) => {
  const candidates = await inspectExternalInspirationPaths(paths)
  return inspiration().importFiles(await readInspectedExternalFiles(candidates))
})
~~~

Resolve each external path with Node realpath, allow regular files only, cap size before read and re-stat before copying. The renderer calls inspection, displays name/size/destination, then calls import only after user confirmation. HTTP/Android expose byte upload only and must not advertise desktop path inspection.

- [ ] **Step 5: Verify and commit.**

Run: npx vitest run src/main/__tests__/inspirationIpc.test.ts src/server/__tests__/inspirationRpc.test.ts src/renderer/src/platform/__tests__/inspirationParity.test.ts src/renderer/src/platform/__tests__/androidApi.test.ts
Expected: PASS.

~~~powershell
git add src/shared/api.ts src/shared/ipc.ts src/shared/platformCapabilities.ts src/main/ipc.ts src/preload/index.ts src/main/index.ts src/server/server.ts src/renderer/src/platform/httpApi.ts src/renderer/src/platform/androidApi.ts src/renderer/src/platform/platformApi.ts src/main/__tests__/inspirationIpc.test.ts src/server/__tests__/inspirationRpc.test.ts src/renderer/src/platform/__tests__/inspirationParity.test.ts
git commit -m "feat: expose inspiration service across platforms"
~~~

### Task 7: Create the Inspiration Desk in existing-page visual language

**Files:**
- Create: src/renderer/src/pages/inspiration/InspirationPage.tsx, InspirationLibrary.tsx, InspirationNaming.tsx, InspirationAnalysis.tsx, InspirationPublicationDialog.tsx
- Create: src/renderer/src/pages/inspiration/__tests__/InspirationPage.test.tsx
- Modify: src/renderer/src/App.tsx, src/renderer/src/layouts/AppLayout.tsx, src/renderer/src/lib/api.ts

- [ ] **Step 1: Write the visible-permission page test.**

~~~tsx
it('shows a source library and hides publication controls for deconstruction', async () => {
  render(<InspirationPage />)
  await user.click(screen.getByRole('tab', { name: '拆解' }))
  expect(screen.getByText('灵感资料')).toBeVisible()
  expect(screen.queryByRole('button', { name: /保存为 Skill|保存为规则集|保存到 docs/ })).toBeNull()
})
~~~

- [ ] **Step 2: Run it before routing.**

Run: npx vitest run src/renderer/src/pages/inspiration/__tests__/InspirationPage.test.tsx
Expected: FAIL because the page and route do not exist.

- [ ] **Step 3: Register the route and compose focused components.**

~~~tsx
const InspirationPage = lazy(() => import('./pages/inspiration/InspirationPage').then(({ InspirationPage: page }) => ({ default: page })))
<Route path="/inspiration" element={<InspirationPage />} />

{ to: '/inspiration', icon: Lightbulb, label: '灵感台', load: () => import('../pages/inspiration/InspirationPage') }
~~~

Use the SettingsDocs-style source sidebar and CreativePage-style tabs: 智能起名, 蒸馏小说, 拆解. Keep the library component responsible only for source list/import; naming only for naming; analysis only for request/report; publication dialog only for preview/confirm.

- [ ] **Step 4: Render every safety and error state.**

~~~tsx
<p className="text-xs leading-5 text-muted">
  选中的资料文本会发送给当前模型供应商。导入前确认文件，发布前确认目标产物。
</p>
~~~

Show empty, loading, extraction failure, unsupported source, size limit, source-changed, cancellation and publication-conflict states. The import modal lists every candidate file and destination. Only distill renders publication actions.

- [ ] **Step 5: Verify and commit.**

Run: npx vitest run src/renderer/src/pages/inspiration/__tests__/InspirationPage.test.tsx
Expected: PASS.

~~~powershell
git add src/renderer/src/pages/inspiration src/renderer/src/App.tsx src/renderer/src/layouts/AppLayout.tsx src/renderer/src/lib/api.ts
git commit -m "feat: add inspiration desk workspace"
~~~

### Task 8: Render generation controls in Settings

**Files:**
- Modify: src/renderer/src/pages/settings/SettingsPage.tsx, src/renderer/src/stores/settingsStore.ts
- Create: src/renderer/src/pages/settings/__tests__/AgentGenerationSettings.test.tsx

- [ ] **Step 1: Write the settings interaction test.**

~~~tsx
it('explains inverse temperature semantics and saves the multi-prose switch', async () => {
  render(<SettingsPage />)
  await user.click(screen.getByRole('tab', { name: '智能体' }))
  expect(screen.getByText('越高越精准稳定；越低越发散创新')).toBeVisible()
  await user.click(screen.getByRole('checkbox', { name: '正文提供多种方案' }))
  expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({
    agentGeneration: expect.objectContaining({ proseAlternativesEnabled: true })
  }))
})
~~~

- [ ] **Step 2: Run the failing form test.**

Run: npx vitest run src/renderer/src/pages/settings/__tests__/AgentGenerationSettings.test.tsx
Expected: FAIL because the controls do not exist.

- [ ] **Step 3: Add one compact card under the existing intelligent-agent tab.**

~~~tsx
<Field label="智能体温度" hint="越高越精准稳定；越低越发散创新。此设置不覆盖模型供应商的专属能力配置。">
  <input aria-label="智能体温度" type="range" min={0} max={100}
    value={settings.agentGeneration.agentTemperature}
    onChange={(event) => void update({ agentGeneration: {
      ...settings.agentGeneration, agentTemperature: Number(event.target.value)
    } })} />
</Field>
<label className="flex items-start gap-2.5 text-sm">
  <input type="checkbox" checked={settings.agentGeneration.proseAlternativesEnabled}
    onChange={(event) => void update({ agentGeneration: {
      ...settings.agentGeneration, proseAlternativesEnabled: event.target.checked
    } })} />
  <span>正文提供多种方案<br /><small className="text-muted">开启后生成 3 个完整候选，选中后才保存。</small></span>
</label>
~~~

- [ ] **Step 4: Test sibling preservation.**

~~~ts
expect(updateSettings.mock.calls.at(-1)?.[0].agentGeneration)
  .toEqual({ agentTemperature: 35, proseAlternativesEnabled: true })
~~~

- [ ] **Step 5: Verify and commit.**

Run: npx vitest run src/renderer/src/pages/settings/__tests__/AgentGenerationSettings.test.tsx src/renderer/src/stores/__tests__
Expected: PASS.

~~~powershell
git add src/renderer/src/pages/settings/SettingsPage.tsx src/renderer/src/pages/settings/__tests__/AgentGenerationSettings.test.tsx src/renderer/src/stores/settingsStore.ts
git commit -m "feat: add agent generation settings controls"
~~~

### Task 9: Generate exactly three transient prose candidates

**Files:**
- Create: src/core/agent/proseCandidates.ts, src/core/agent/__tests__/proseCandidates.test.ts
- Modify: src/shared/inspiration.ts, src/shared/types.ts, src/shared/api.ts
- Modify: core/main agent loops and all platform bridges that carry applyProseCandidate

- [ ] **Step 1: Write the core safety tests.**

~~~ts
it('returns three complete candidates without saving a chapter', async () => {
  const result = await service.generate({ chapterId: chapter.id, expectedRevision, instruction: '写正文' }, context)
  expect(result.candidates).toHaveLength(3)
  expect(result.candidates.every((item) => item.content.trim().length > 200)).toBe(true)
  expect(saveChapter).not.toHaveBeenCalled()
})

it('saves only a selected candidate and rejects a stale chapter revision', async () => {
  await expect(service.apply({ candidateId, expectedRevision })).resolves.toMatchObject({ wordCount: expect.any(Number) })
  await expect(service.apply({ candidateId, expectedRevision: 'stale' })).rejects.toMatchObject({ code: 'CONFLICT' })
})
~~~

- [ ] **Step 2: Run the failing candidate test.**

Run: npx vitest run src/core/agent/__tests__/proseCandidates.test.ts
Expected: FAIL because ProseCandidateService does not exist.

- [ ] **Step 3: Implement isolated generation with tools disabled.**

~~~ts
export interface ProseCandidate {
  id: string; chapterId: string; expectedRevision: string; title: string
  rationale: string; content: string; wordCount: number; createdAt: number
}
export interface ProseCandidateSet { id: string; candidates: ProseCandidate[]; expiresAt: number }

const results = await Promise.all([0, 1, 2].map((variant) => gateway.call({
  callId: runId + ':prose:' + variant,
  purpose: 'prose-candidate',
  execute: () => adapter.stream(model, {
    system: buildProseCandidatePrompt(variant), messages, tools: [], signal, params
  }, apiKey, handlers)
})))
~~~

Capture the chapter content revision before generation. Require all three complete candidates before emitting one prose-candidates event. Keep the set in a bounded in-memory per-run map; discard it on cancellation, expiry or explicit dismissal. Do not import the regular tool registry and do not call saveChapter in generate.

- [ ] **Step 4: Add the explicit apply API.**

Insert this member immediately before the existing done member of the AgentEvent union in src/shared/types.ts:

~~~ts
| { type: 'prose-candidates'; runId: string; set: ProseCandidateSet }
~~~

Then extend the platform API:

~~~ts
export interface StoryFabricApi {
  applyProseCandidate(input: { candidateId: string; expectedRevision: string }): Promise<ChapterMeta>
}
~~~

The apply handler finds the candidate, compares current serialized chapter revision, writes the selected body with the controlled chapter writer and returns its final ChapterMeta. Unknown, expired or stale IDs return typed conflicts. Integrate candidate generation only for explicit full-prose requests when proseAlternativesEnabled is true; retain current single-response behavior otherwise.

- [ ] **Step 5: Verify and commit.**

Run: npx vitest run src/core/agent/__tests__/proseCandidates.test.ts src/core/agent/__tests__/agentLoop.test.ts src/main/__tests__/runtimeEvents.test.ts
Expected: PASS.

~~~powershell
git add src/core/agent/proseCandidates.ts src/core/agent/__tests__/proseCandidates.test.ts src/shared/inspiration.ts src/shared/types.ts src/shared/api.ts src/core/agent/agentLoop.ts src/main/agent/agentLoop.ts src/server/server.ts src/main/ipc.ts src/preload/index.ts src/renderer/src/platform/httpApi.ts src/renderer/src/platform/androidApi.ts
git commit -m "feat: generate and apply prose candidates safely"
~~~

### Task 10: Show candidates and repair chapter freshness/status presentation

**Files:**
- Create: src/renderer/src/components/chat/ProseCandidateDialog.tsx, src/renderer/src/components/chat/__tests__/ProseCandidateDialog.test.tsx
- Modify: src/renderer/src/stores/chatStore.ts, chatEvents.ts, workspaceStore.ts and focused tests
- Modify: src/renderer/src/pages/chat/ChatPage.tsx, src/renderer/src/pages/chapters/ChaptersPage.tsx, src/renderer/src/lib/utils.ts
- Modify: core agent event mapping only to include final ChapterMeta after an applied chapter write

- [ ] **Step 1: Write UI/store regressions.**

~~~tsx
it('does not save before selection and applies only the chosen candidate', async () => {
  render(<ProseCandidateDialog set={candidateSet} />)
  expect(applyProseCandidate).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '选用并保存', exact: true }))
  expect(applyProseCandidate).toHaveBeenCalledWith({ candidateId: 'candidate_1', expectedRevision: 'rev_1' })
})
~~~

~~~ts
it('presents a draft-stage main chapter as 正文 · 初稿', () => {
  expect(chapterPresentation({ box: 'main', status: 'draft' } as ChapterMeta))
    .toEqual({ location: '正文', phase: '初稿' })
})

it('eagerly replaces saved word count and ignores older refresh output', async () => {
  dispatchAppliedChapterMeta({ id: 'cha_1', title: '新章', box: 'main', status: 'draft', wordCount: 321, volume: '第一卷', order: 1 })
  expect(useWorkspace.getState().summary?.chapters[0].wordCount).toBe(321)
})
~~~

- [ ] **Step 2: Run the regressions.**

Run: npx vitest run src/renderer/src/components/chat/__tests__/ProseCandidateDialog.test.tsx src/renderer/src/stores/__tests__/chatCompletion.test.ts src/renderer/src/stores/__tests__/chatEvents.test.ts src/renderer/src/pages/chapters/__tests__/ChaptersPage.test.tsx
Expected: FAIL because the dialog, presentation helper and final metadata payload do not exist.

- [ ] **Step 3: Implement the selection dialog.**

~~~tsx
{candidateSet && <ProseCandidateDialog
  set={candidateSet}
  onApply={async (candidate) => {
    const saved = await api.applyProseCandidate({ candidateId: candidate.id, expectedRevision: candidate.expectedRevision })
    applyChapterMeta(saved)
    clearProseCandidates(candidateSet.id)
  }}
  onDismiss={() => clearProseCandidates(candidateSet.id)}
/>}
~~~

Render three expandable complete-body cards, a pending state preventing double apply, conflict feedback that keeps candidates available and a note that unselected candidates are not saved to the project.

- [ ] **Step 4: Carry saved metadata and distinguish box from editorial phase.**

~~~ts
export interface AppliedChange {
  entityKind: EntityKind
  entityId: string
  chapter?: ChapterMeta
}

export const CHAPTER_STATUS_LABEL: Record<ChapterStatus, string> = {
  draft: '初稿', revised: '已修订', final: '定稿'
}

export function chapterPresentation(chapter: Pick<ChapterMeta, 'box' | 'status'>): { location: string; phase: string } {
  return {
    location: chapter.box === 'main' ? '正文' : chapter.box === 'trash' ? '回收箱' : '草稿箱',
    phase: CHAPTER_STATUS_LABEL[chapter.status]
  }
}
~~~

After any agent chapter write, emit final ChapterMeta from the saved document. chatStore first replaces the matching WorkspaceSummary chapter metadata synchronously, then starts a sequence-numbered refresh; a refresh older than the last applied event cannot overwrite it. The chapter editor reloads body/count only when locally clean; otherwise it retains the user draft and presents an external-change conflict.

- [ ] **Step 5: Verify and commit.**

Run: npx vitest run src/renderer/src/components/chat/__tests__/ProseCandidateDialog.test.tsx src/renderer/src/stores/__tests__/chatCompletion.test.ts src/renderer/src/stores/__tests__/chatEvents.test.ts src/renderer/src/pages/chapters/__tests__/ChaptersPage.test.tsx src/core/agent/__tests__/agentLoop.test.ts
Expected: PASS.

~~~powershell
git add src/renderer/src/components/chat/ProseCandidateDialog.tsx src/renderer/src/components/chat/__tests__/ProseCandidateDialog.test.tsx src/renderer/src/stores/chatStore.ts src/renderer/src/stores/chatEvents.ts src/renderer/src/stores/workspaceStore.ts src/renderer/src/pages/chat/ChatPage.tsx src/renderer/src/pages/chapters/ChaptersPage.tsx src/renderer/src/lib/utils.ts src/shared/types.ts src/core/agent/agentLoop.ts src/main/agent/agentLoop.ts
git commit -m "fix: refresh chapter metadata and clarify chapter phase"
~~~

### Task 11: Cross-platform integration, build and release 0.2.1

**Files:**
- Create: src/core/inspiration/__tests__/integration.test.ts
- Modify: package.json, root package-lock.json
- Create/update through scripts only: release/0.2.1/**

- [ ] **Step 1: Add core integration tests for non-writing and publishing boundaries.**

~~~ts
it('imports, distills, previews docs publication and preserves the result in an archive', async () => {
  const [source] = await service.importFiles([{ name: 'sample.txt', bytes: bytes('叙事资料') }])
  const report = await service.analyze({ kind: 'distill', sourceIds: [source.id], goal: '提炼风格' }, modelContext)
  const preview = await service.previewPublication({ analysisId: report.id, target: 'docs', sectionIds: [report.sections[0].id], documentName: '风格.md' })
  await service.confirmPublication({ token: preview.token })
  expect(await store.readText('docs/风格.md')).toContain('来源')
})
~~~

Also test that deconstruction cannot publish, Android/HTTP do not expose path inspection, desktop does, and disabling candidates retains existing single-response chat behavior.

- [ ] **Step 2: Run feature-focused tests and builds.**

Run:
~~~powershell
npm test
npm run build
npm run web:build
npm run mobile:build
~~~

Expected: PASS. Record any pre-existing unrelated failure by its original test name; do not mask it.

- [ ] **Step 3: Bump both manifests.**

~~~powershell
npm pkg set version=0.2.1
npm install --package-lock-only --ignore-scripts
~~~

Verify package.json and the root package-lock packages entry both say 0.2.1.

- [ ] **Step 4: Build all required release artifacts.**

Run:
~~~powershell
npm run server:bundle
npm run dist:win
~~~

Expected: release/0.2.1/storyfabric-server-0.2.1.tar.gz, server-bundle/VERSION, latest.yml, installer and win-unpacked/resources/server-bundle.tar.gz all exist.

- [ ] **Step 5: Verify release contents/hashes and commit only planned paths.**

~~~powershell
$release = 'release/0.2.1'
(Get-Content package.json -Raw | ConvertFrom-Json).version
(Get-Content package-lock.json -Raw | ConvertFrom-Json).packages.''.version
Get-Content "$release/server-bundle/VERSION"
tar -xOf "$release/storyfabric-server-0.2.1.tar.gz" VERSION
tar -xOf "$release/win-unpacked/resources/server-bundle.tar.gz" VERSION
Get-FileHash "$release/storyfabric-server-0.2.1.tar.gz" -Algorithm SHA256
Get-FileHash "$release/win-unpacked/resources/server-bundle.tar.gz" -Algorithm SHA256
git diff --check
git status --short
~~~

Expected: all three version reads equal 0.2.1; the embedded and standalone archive SHA-256 values are exactly equal; only exact planned files are staged. Commit with git commit -m "release: 0.2.1".
