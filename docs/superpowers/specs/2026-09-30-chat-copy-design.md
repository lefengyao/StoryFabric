# Chat Copy and Selection

The user's requested controls apply to both the main chat page and the story-side chat panel, including streaming replies.

- A shared copy button uses the existing platform clipboard abstraction (Electron, Capacitor, and browser fallback). It reports success only after the write completes and displays a readable error on failure.
- Each nonempty user or assistant message has a visible copy action below its bubble. Whole-message copying preserves the source text, including Markdown.
- Markdown block code receives a header with a language label and a copy button; inline code stays inline. Block copying preserves indentation and blank lines while removing the renderer's added final newline.
- Message text explicitly allows selection. A contrasting highlight makes selection visible in the colored user bubble. Android's native selection menu remains available on marked message/code text instead of being intercepted by the app context menu.
- The agent's response guidance uses fenced blocks for independently reusable prompts, templates, commands, configuration, and snippets.

Verify fenced/indented blocks, inline code, copy text fidelity, both chat surfaces and streaming replies, existing clipboard platform behavior, type checks, and the full test suite. Build all distributions for 0.2.22 and verify versions and release checksums.

## Verification

- Focused rendering and clipboard tests passed. Block copy text preserves indentation, empty lines and trailing spaces; whole-message actions receive the original Markdown source.
- Node and renderer TypeScript checks passed. Full suite: 205 files passed, 1122 tests passed, 5 skipped.
- Rebuilt Windows installer/portable ZIP, Android Debug/unsigned Release APK and unsigned Release AAB, and the standalone Linux server archive for 0.2.22 (Android versionCode 22).
- Verified source, Android APK output metadata, server stage/archive versions, Windows update manifest and installer SHA512, eight release SHA256 entries and five internal server manifest entries.
- Server archive SHA256: `79ad3185b37d4f036c7c57c2b04bb748366df111e14a951115f8bd2fe1c8af89`.
- Android native long-press selection has not been checked on a physical device. Browser UI automation could not connect to the preview; the checks above cover code, rendering and builds.
