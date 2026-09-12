# Sidebar and Reading Position State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the desktop navigation to a persistent 158px icon-plus-label sidebar with a restore-to-icon control, and persist both list and reader scroll positions per workspace and page.

**Architecture:** Keep UI state local to the renderer. Add one safe local-storage helper for the sidebar preference and one versioned scroll-position helper/hook for DOM containers; key positions by stable workspace path, route scope, subview, and entity where needed. Integrate the hook into the chapters, outline, and characters pages without changing project data, server APIs, or route semantics.

**Tech Stack:** React 19, TypeScript, Zustand workspace state, Tailwind classes, browser `localStorage`, Vitest.

---

## File map

- Create `src/renderer/src/lib/navigationPreference.ts`: safe read/write for the persistent expanded/collapsed sidebar preference.
- Create `src/renderer/src/lib/persistentScroll.ts`: versioned key creation, safe storage serialization, and a debounced React hook for one scroll container.
- Create `src/renderer/src/lib/__tests__/navigationPreference.test.ts`: preference defaults, persistence, and malformed storage cases.
- Create `src/renderer/src/lib/__tests__/persistentScroll.test.ts`: key isolation, numeric validation, and serialization cases using an injected storage double.
- Modify `src/renderer/src/layouts/AppLayout.tsx`: desktop width state, icon-plus-label navigation, expand/collapse button, and responsive classes.
- Modify `src/renderer/src/components/editor/MarkdownEditor.tsx`: optionally expose CodeMirror’s real `scrollDOM` through a mutable ref so editor reading position can be restored.
- Modify `src/renderer/src/pages/chapters/ChaptersPage.tsx`: attach list and editor/read-only refs with scopes for chapter box and chapter ID.
- Modify `src/renderer/src/pages/outline/OutlinePage.tsx`: attach outline list and reader/editor refs with kind, chapter filter, and document ID scopes.
- Modify `src/renderer/src/pages/characters/CharactersPage.tsx`: attach character list and read-only/editor refs with character ID scope.
- Modify `src/renderer/src/pages/characters/CharactersPage.tsx` and `src/renderer/src/pages/outline/OutlinePage.tsx` only where needed to pass reader refs; do not alter their data contracts.
- Update `docs/superpowers/specs/2026-09-12-sidebar-reading-state-design.md` only if implementation evidence requires a clarified constraint; otherwise keep the approved spec unchanged.

## Task 1: Add testable persistence primitives

**Files:** create the two helpers and their two tests listed above.

- [x] **Step 1: Write failing tests for sidebar preference behavior.**

  Test `readSidebarExpanded(null)` returns `true`, a stored `false` returns `false`, a stored `true` returns `true`, and invalid JSON or an unknown value returns the default. Test `writeSidebarExpanded` writes the exact JSON value and does not throw when `setItem` throws.

- [x] **Step 2: Run the preference test to verify it fails.**

  Run:

  ```powershell
  npx vitest run src/renderer/src/lib/__tests__/navigationPreference.test.ts --pool=threads --maxWorkers=1
  ```

  Expected: FAIL because `navigationPreference.ts` does not exist yet.

- [x] **Step 3: Implement the minimal safe preference helper.**

  Use a constant key and an injected `Storage | null` argument so tests do not require jsdom:

  ```ts
  export const SIDEBAR_EXPANDED_KEY = 'storyfabric.ui.sidebar-expanded.v1'
  export function readSidebarExpanded(storage: Storage | null, fallback = true): boolean {
    try {
      const value = storage?.getItem(SIDEBAR_EXPANDED_KEY)
      return value === 'true' ? true : value === 'false' ? false : fallback
    } catch {
      return fallback
    }
  }
  export function writeSidebarExpanded(storage: Storage | null, expanded: boolean): void {
    try { storage?.setItem(SIDEBAR_EXPANDED_KEY, String(expanded)) } catch { /* unavailable storage is non-fatal */ }
  }
  ```

- [x] **Step 4: Write failing tests for scroll-key and scroll-value behavior.**

  Assert that `scrollStorageKey('workspace-a', 'chapters:list:main')` differs from workspace B and from `chapters:list:draft`; `readScrollPosition` returns `{top: 42, left: 3}` for valid JSON, returns `null` for negative, non-finite, non-object, or malformed values, and `writeScrollPosition` serializes only `top` and `left` while swallowing storage errors.

- [x] **Step 5: Run the scroll test to verify it fails.**

  Run:

  ```powershell
  npx vitest run src/renderer/src/lib/__tests__/persistentScroll.test.ts --pool=threads --maxWorkers=1
  ```

  Expected: FAIL because `persistentScroll.ts` does not exist yet.

- [x] **Step 6: Implement scroll primitives and the hook.**

  Define `ScrollPosition`, use `encodeURIComponent` for each key segment, clamp valid values to non-negative finite numbers, and expose `usePersistentScrollPosition(ref, workspaceId, scope, enabled = true)`. The hook must:

  1. do nothing when disabled, the workspace ID is empty, or the ref is not mounted;
  2. restore the saved position in `requestAnimationFrame` after the container mounts;
  3. add one `scroll` listener with a 120ms `setTimeout` debounce;
  4. flush the current position and remove the listener on cleanup;
  5. catch storage and DOM errors without affecting the page.

- [x] **Step 7: Run both helper tests.**

  Run:

  ```powershell
  npx vitest run src/renderer/src/lib/__tests__/navigationPreference.test.ts src/renderer/src/lib/__tests__/persistentScroll.test.ts --pool=threads --maxWorkers=1
  ```

  Expected: all tests PASS.

- [x] **Step 8: Commit the isolated persistence primitives.**

  ```powershell
  git add src/renderer/src/lib/navigationPreference.ts src/renderer/src/lib/persistentScroll.ts src/renderer/src/lib/__tests__/navigationPreference.test.ts src/renderer/src/lib/__tests__/persistentScroll.test.ts
  git commit -m "feat: add persistent sidebar and scroll state"
  ```

## Task 2: Implement the persistent compact sidebar

**Files:** modify `src/renderer/src/layouts/AppLayout.tsx`; extend `navigationPreference.test.ts` only if a pure class/state helper is extracted.

- [x] **Step 1: Add state initialization and persistence.**

  Initialize `sidebarExpanded` with `readSidebarExpanded(window.localStorage, true)` behind a `typeof window` guard. When it changes, call `writeSidebarExpanded`; treat storage exceptions as non-fatal. The first launch is expanded, matching the approved design.

- [x] **Step 2: Update desktop navigation classes.**

  Keep the existing mobile bottom-nav classes unchanged. On `sm` and above, use `sm:w-[158px]` for expanded and `sm:w-16` for collapsed. In expanded mode each nav link uses a left-aligned row with the existing icon and a visible label; in collapsed mode retain the existing centered icon-only row and hover tooltip. Preserve the existing active accent styling, prefetch handlers, brand link, settings link, and route order.

- [x] **Step 3: Add the restore/toggle button.**

  Import `PanelLeftClose` and `PanelLeftOpen`. Render a desktop-only button at the bottom of the sidebar with an accessible `title` and `aria-label`: expanded mode says “还原为纯图标导航” and collapses; collapsed mode says “展开文字导航” and expands. The expanded button includes the text “还原图标”; the collapsed button remains icon-only. Do not add this control to the mobile bottom navigation.

- [x] **Step 4: Run type checking and the existing renderer tests.**

  Run:

  ```powershell
  npx tsc --build --pretty false
  npx vitest run src/renderer/src/lib/__tests__/navigationPreference.test.ts --pool=threads --maxWorkers=1
  ```

  Expected: type checking and tests PASS.

## Task 3: Expose editor scroll containers safely

**Files:** modify `src/renderer/src/components/editor/MarkdownEditor.tsx`.

- [x] **Step 1: Add an optional mutable scroll ref without changing existing callers.**

  Extend the props with `scrollRef?: React.MutableRefObject<HTMLElement | null>`. After creating the CodeMirror view, assign `scrollRef.current = view.scrollDOM`; on cleanup clear it only if it still points to that view’s `scrollDOM`. Existing callers remain valid because the prop is optional.

- [x] **Step 2: Preserve external-change behavior.**

  Do not change the existing `externalEditorChange` annotation or update listener. The only new behavior is exposing the already-created CodeMirror scroll element.

- [x] **Step 3: Run editor and type tests.**

  ```powershell
  npx vitest run src/renderer/src/lib/__tests__/editorChange.test.ts --pool=threads --maxWorkers=1
  npx tsc --build --pretty false
  ```

  Expected: both commands PASS.

## Task 4: Restore chapter list and reading positions

**Files:** modify `src/renderer/src/pages/chapters/ChaptersPage.tsx`.

- [x] **Step 1: Add refs and workspace scope.**

  Create `chapterListRef = useRef<HTMLDivElement | null>(null)` and `chapterReaderRef = useRef<HTMLElement | null>(null)`. Use `summary?.path ?? ''` as the stable workspace ID. Call the hook with `chapters:list:${box}` for the left list and `chapters:reader:${box}:${draft?.id ?? selectedId ?? 'overview'}` for the reader.

- [x] **Step 2: Attach the list ref.**

  Add `ref={chapterListRef}` to the existing `min-h-0 flex-1 overflow-y-auto` chapter-list container. Do not attach it to the outer responsive column, because only the list’s scrollTop should be remembered.

- [x] **Step 3: Attach the reader ref in both read and edit modes.**

  In the read-only branch, add `ref={chapterReaderRef}` to the actual `overflow-y-auto` reading container. In the editor branch, pass `scrollRef={chapterReaderRef}` to `MarkdownEditor`; use the same scope key so switching between read and edit mode restores the same chapter position.

- [x] **Step 4: Verify chapter scope isolation.**

  Add or extend pure key tests for `chapters:list:main` versus `chapters:list:draft`, and for two chapter IDs. Run the focused persistence tests and type checking. Expected: positions are not shared between boxes or chapters.

## Task 5: Restore outline positions

**Files:** modify `src/renderer/src/pages/outline/OutlinePage.tsx`.

- [x] **Step 1: Add list and reader refs.**

  Use `outlineListRef` for the existing outline list container and `outlineReaderRef` for the read-only article or CodeMirror scroll DOM. Use keys `outline:list:${kind}:${chapterId || 'all'}` and `outline:reader:${kind}:${chapterId || 'all'}:${draft?.id ?? selected?.id ?? 'overview'}`.

- [x] **Step 2: Attach refs without changing selection behavior.**

  Add the list ref to the list’s existing `overflow-y-auto` div. Add the reader ref to the read-only `overflow-y-auto` div and pass it to `MarkdownEditor` in edit mode. Keep the existing `kind` and `chapterId` change handlers; the hook’s key change will restore the correct list position after the new filtered content mounts.

- [x] **Step 3: Verify outline filter isolation.**

  Test that total and chapter-filter keys differ, and run type checking plus the focused persistence tests. Expected: switching total/章纲 or chapter filters never reuses another filter’s position.

## Task 6: Restore character positions

**Files:** modify `src/renderer/src/pages/characters/CharactersPage.tsx`.

- [x] **Step 1: Add list/detail refs and workspace scope.**

  Add `characterListRef` and `characterReaderRef`, call the hook with `characters:list` and `characters:reader:${draft?.id ?? selected?.id ?? 'overview'}`. The character ID in the reader key prevents one character’s long detail position from applying to another character.

- [x] **Step 2: Attach the list ref.**

  Add it to the existing left-card list `overflow-y-auto` container. Keep search and faction collapse behavior unchanged; changing search results does not overwrite the stored page position.

- [x] **Step 3: Pass the reader ref through `ReadOnlyCard` and `CharacterForm`.**

  Add an optional `scrollRef` prop to `ReadOnlyCard` and attach it to its existing `h-full overflow-y-auto` wrapper. Pass the same ref to `MarkdownEditor` from `CharacterForm` so read and edit modes share the character detail key.

- [x] **Step 4: Verify character isolation.**

  Test that `characters:reader:character-a` differs from `characters:reader:character-b`, then run the focused tests and type checking. Expected: the character list and each character detail restore independently.

## Task 7: Full verification and release artifacts

**Files:** no new source files; inspect the changed renderer files and generated artifacts.

- [ ] **Step 1: Run the complete single-worker test suite.**

  Executed on 2026-09-12: 514 tests passed, 1 skipped, and the pre-existing `src/main/agent/__tests__/agentLoop.test.ts` abort-session case timed out after 15 seconds. This remains unchecked because the suite is not fully green and the failure is outside this feature.

  ```powershell
  npx vitest run --pool=threads --maxWorkers=1
  ```

  Expected: all existing tests plus the new persistence tests PASS, with any pre-existing skipped test explicitly reported.

- [x] **Step 2: Run all builds.**

  ```powershell
  npx tsc --build --pretty false
  npm run build
  npm run web:build
  npm run mobile:build
  npm run server:bundle
  npm run dist:win
  ```

  Expected: all commands exit successfully; the Windows build is run only after any running StoryFabric executable is closed.

- [x] **Step 3: Verify release consistency required by `AGENTS.md`.**

  Verified snapshot `0.1.2-snapshot.20260912` in package metadata, bundle VERSION files, archives, `latest.yml`, and installer names. Standalone and embedded server archives have identical SHA256: `55BE8EEBB394549485DBB23EB4CD58D165E5A6F47C1DC08BB12710081A046E0A`.

  Check that `package.json`, the root `package-lock.json` version, `release/0.1.2-snapshot.20260912/server-bundle/VERSION`, the standalone archive `VERSION`, the embedded archive `VERSION`, `latest.yml`, and installer filenames all contain `0.1.2-snapshot.20260912`. Compare SHA256 for the standalone archive and `win-unpacked/resources/server-bundle.tar.gz`; expected: exact match.

- [x] **Step 4: Review the diff and commit only feature changes.**

  Feature commits were independently reviewed and approved. Existing unrelated dirty-worktree changes were not staged; the plan status edit remains unstaged for this documentation update.

  ```powershell
  git diff --check
  git status --short
  git diff -- src/renderer/src/layouts/AppLayout.tsx src/renderer/src/lib/navigationPreference.ts src/renderer/src/lib/persistentScroll.ts src/renderer/src/components/editor/MarkdownEditor.tsx src/renderer/src/pages/chapters/ChaptersPage.tsx src/renderer/src/pages/outline/OutlinePage.tsx src/renderer/src/pages/characters/CharactersPage.tsx
  ```

  Do not stage unrelated existing worktree changes. Commit only the sidebar/scroll implementation and its tests with:

  ```powershell
  git add src/renderer/src/layouts/AppLayout.tsx src/renderer/src/lib/navigationPreference.ts src/renderer/src/lib/persistentScroll.ts src/renderer/src/lib/__tests__/navigationPreference.test.ts src/renderer/src/lib/__tests__/persistentScroll.test.ts src/renderer/src/components/editor/MarkdownEditor.tsx src/renderer/src/pages/chapters/ChaptersPage.tsx src/renderer/src/pages/outline/OutlinePage.tsx src/renderer/src/pages/characters/CharactersPage.tsx
  git commit -m "feat: persist sidebar and reading positions"
  ```
