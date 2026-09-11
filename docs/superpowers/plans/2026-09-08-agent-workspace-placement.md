# Agent Workspace Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the agent from placing draft chapter prose in the main-text box and prevent chapter outlines from being saved as total outlines, while keeping the agent policy consistent across the core and Electron main processes.

**Architecture:** Treat chapter `box`/outline `kind` as explicit write-time placement contracts. Put the shared agent policy text in the core agent module and put structural validation in a small core tool-policy module. Both tool registries call the same validators before generating a pending change. Keep the existing confirmation workflow and storage compatibility for non-agent UI callers.

**Tech Stack:** TypeScript, Vitest, Electron/Vite, Markdown front matter, Node and renderer workspace stores.

---

## Task 1: Lock down the placement contracts with tests

- [x] Add unit tests for agent chapter writes: missing `box` is rejected, `draft` is accepted without a volume, and `main` requires `volumeId`.
- [x] Add unit tests for outline writes: missing `kind` is rejected, chapter outlines require `chapterId`, and total outlines cannot carry `chapterId`.
- [x] Run the focused tests and confirm they fail before implementation.

## Task 2: Add shared policy and runtime validation

- [x] Create a small shared policy module containing the canonical distinction between chapter `box` and chapter `status`, and between total and chapter outlines.
- [x] Create a small runtime validation module with descriptive errors for ambiguous agent write arguments.
- [x] Rewrite the core system prompt to include the canonical policy and concrete tool-call examples.
- [x] Make the main-process prompt reuse the core policy instead of maintaining a second divergent copy.

## Task 3: Enforce the contracts at both tool boundaries

- [x] Expand `save_chapter` schemas with explicit `box`/`volumeId` fields and require `box`.
- [x] Expand `save_outline_doc` schemas with explicit `kind`/`chapterId` fields and require `kind`.
- [x] Validate these arguments before simulation in both core and main registries.
- [x] Preserve placement fields in simulated documents and verify chapter-outline targets exist.
- [x] Require an identifier for `get_chapter_outline` so the tool cannot silently return the first unrelated outline.

## Task 4: Verify, package, and review cleanliness

- [x] Run focused tests, the complete Vitest suite, TypeScript/build checks, and the Windows packaging script.
- [x] Start the packaged Windows executable for a smoke test and inspect logs/process exit behavior.
- [x] Review the diff for accidental generated files, oversized new modules, unsafe defaults, and unrelated edits; preserve the user’s reproduction files.
- [ ] Update the session log with results and remaining risks.
