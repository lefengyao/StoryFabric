# Android Responsive Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fit every Android page to portrait and landscape viewports without whole-page horizontal scrolling while keeping the PC visual language.

**Architecture:** Android-only semantic data attributes identify the app shell, list panes, and edit inspectors. CSS under `.android-native` supplies a 48 px landscape icon rail, 156 px list panes, a 300 px overlay agent panel, and bounded portrait drawers. Desktop behavior remains on existing Tailwind classes.

**Tech Stack:** React 19, Tailwind CSS 4, Capacitor 7, Vitest, Vite.

---

### Task 1: Android shell and navigation

**Files:** `src/renderer/src/layouts/AppLayout.tsx`, `src/renderer/src/styles/index.css`

- [ ] **Step 1: Mark the navigation rail, header, main area, and drawer trigger in AppLayout.** Use `data-android-nav-rail`, `data-android-app-header`, `data-android-main`, and `data-android-nav-trigger`. Derive `showSidebarExpanded = sidebarExpanded && !isAndroid` for the icon rail labels.
- [ ] **Step 2: Add Android-scoped rules to CSS.** In landscape, display the icon rail at 48 px, hide the header's drawer trigger, use one header row, and keep main at `min-width:0; overflow-x:hidden`. In portrait, leave navigation as a bounded drawer. Preserve safe-area insets.
- [ ] **Step 3: Run the renderer type check and verify the desktop sidebar preference tests.** Run `npx tsc --noEmit -p tsconfig.web.json` and `npm test -- --maxWorkers=2 src/renderer/src/lib/__tests__/layoutPresentation.test.ts`.

### Task 2: Agent and session panels

**Files:** `src/renderer/src/components/chat/ChatSidebar.tsx`, `src/renderer/src/pages/chat/ChatPage.tsx`, `src/renderer/src/styles/index.css`

- [ ] **Step 1: Mark the agent flyout/panel and chat session list/trigger/backdrop with data attributes.**
- [ ] **Step 2: On Android, position the agent flyout over the right edge with `width:min(300px,86vw)` and no flex space consumption. In landscape, show a 156 px session list in normal flow; in portrait, retain the overlay drawer at at most 280 px.**
- [ ] **Step 3: Verify opening, closing, and orientation changes do not leave a backdrop over the content.** Run the ChatSidebar tests and inspect portrait/landscape browser layouts.

### Task 3: Page panes and overflow

**Files:** `CharactersPage.tsx`, `ChaptersPage.tsx`, `OutlinePage.tsx`, `SettingsDocsPage.tsx`, `NotesPage.tsx`, `EventsPage.tsx`, `RelationsPage.tsx`, and `src/renderer/src/styles/index.css`

- [ ] **Step 1: Mark each document list with `data-android-list-pane` and graph edit sidebars with `data-android-inspector`.**
- [ ] **Step 2: Landscape list panes use 156 px and inspectors at most 280 px. Portrait list panes use a short vertical scroll area; inspectors cover the graph and do not widen the flex row.**
- [ ] **Step 3: Keep root/main width within the viewport. Wrap narrow toolbar controls and limit long labels; leave graph/timeline horizontal panning inside their own scroll containers.**
- [ ] **Step 4: Check all route shells at 360×710, 710×360, 800×360, and 1024×600 CSS px, recording any element whose `scrollWidth > clientWidth` outside a graph canvas.**

### Task 4: Verification and release

**Files:** `package.json`, `package-lock.json`, `android/app/build.gradle`, `release/<version>/`

- [ ] **Step 1: Run relevant renderer tests, type checks, the full test suite, and `npm run mobile:sync`. Confirm mobile CSS contains no `@layer`.**
- [ ] **Step 2: Increment the aligned app and Android versions, then build Android Debug/Release APK and AAB using JDK 21.**
- [ ] **Step 3: Build the Linux server bundle and Windows NSIS/portable outputs required by `AGENTS.md`; verify versions, archive contents, update manifest, and SHA256 checksums.**
- [ ] **Step 4: Commit source changes and confirm `git status --porcelain` is empty. Report that physical Android 10 device testing is pending if no device is connected.**
