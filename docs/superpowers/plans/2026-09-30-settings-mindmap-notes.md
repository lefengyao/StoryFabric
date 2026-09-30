# Setting Mind Map and Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Give setting and tag nodes title, summary, and detail; show a mind map, detail dialog, text view, and optional PNG notes.

**Architecture:** Extend the existing setting front matter with optional summary and per-tag detail records. Keep graph projection, SVG/PNG export, and UI editing in separate modules. Fetch full setting bodies for reading/export without expanding the list metadata API.

**Tech Stack:** TypeScript, React, React Flow, Vitest, Vite, Capacitor, Electron.

---

### Task 1: Persist the new node fields

**Files:** `src/shared/types.ts`, `src/core/workspace/entityStore.ts`, `src/core/workspace/__tests__/settingTagHierarchy.test.ts`

- [x] Add failing persistence and validation tests for summary and tag details, including old files.
- [x] Add optional fields, validate detail keys and string values, and retain existing hierarchy semantics.
- [x] Run focused tests and type check.

### Task 2: Let the agent write the fields

**Files:** `src/core/tools/writeSchemas.ts`, `src/core/tools/registry.ts`, `src/core/agent/prompts.ts`, `src/core/tools/__tests__/settingTagTool.test.ts`

- [x] Add failing schema and write tests.
- [x] Expose summary and tag details in schema, pending-change preview, and writing guidance.
- [x] Run focused tests.

### Task 3: Project and display the tree

**Files:** `src/renderer/src/lib/settingsTree.ts`, `SettingsTreeView.tsx`, `SettingsDocsPage.tsx`, `TagHierarchyEditor.tsx`, relevant tests.

- [x] Add failing projection tests for setting and tag summary/detail.
- [x] Implement node projection, detail editor, detail dialog, and text view.
- [x] Match the reference's curved warm branches and title/summary node treatment; keep old tags visible.

### Task 4: Export diagram and optional notes

**Files:** `src/renderer/src/lib/settingsTreeImage.ts`, `settingsTreeImage.test.ts`, `SettingsTreeView.tsx`.

- [x] Add failing SVG tests for notes enabled/disabled, wrapping, ordering, and escaping.
- [x] Add an include-notes control, fetch setting bodies, and render numbered annotations under the diagram.
- [x] Verify PNG dimensions and canvas bounds.

### Task 5: Release

- [x] Run focused and full tests, type checks, Android sync, and CSS compatibility check.
- [x] Increment aligned versions and build Android Debug/Release/AAB, Linux server bundle, and Windows installer/portable.
- [x] Verify archive contents and SHA256 manifest; commit source with clean Git status.

## Verification record

- Version: 0.2.21 / Android versionCode 21.
- Focused persistence, agent, projection, and image export tests: 28 passed. Full suite: 204 files passed, 1117 tests passed, 5 skipped. Both TypeScript projects passed.
- Verified a rendered PNG sample with curved branches, wrapped summaries, and detailed notes. Added a failing then passing regression for tall intermediate nodes in separate subtrees.
- All Windows, Android, and Linux distributions rebuilt. Server archive SHA256: `7bba1cb197a60f7db0522effc9b982a02e90f7ce71e796500d3840c01ec320f6`; VERSION and five internal manifest files verified directly from the archive. Eight release SHA256 entries verified.
- Android Release APK/AAB are unsigned; no physical Android device was available for UI acceptance.
- A server disconnect timing test failed while builds and tests ran concurrently; its isolated run and the final full suite without concurrent builds passed.
