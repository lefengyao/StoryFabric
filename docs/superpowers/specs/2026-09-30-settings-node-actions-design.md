# Setting Tree Node Actions

Continue the approved three-part tree model. Clicking any chart node opens its detail dialog. A visible “操作” button expands “添加子节点” and “删除此节点”.

- Adding a child uses an inline form with title, summary and detailed Markdown content. Title is required and unique within the owning setting's tags. The chosen node is the explicit parent; all three fields round trip through the existing platform API.
- Deleting a tag asks for confirmation, removes only that node and connects its children to its original parent (or the owning setting). Descendant summaries and details remain intact.
- Deleting a setting asks for confirmation and moves the setting and its embedded tags to the existing trash. Independent child settings remain stored, following the existing orphan/restore behavior.
- UI, persistence actions and tree layout remain separate modules. Mutations load the latest setting before writing and reject stale parent nodes. They use the common Electron/Android/server API and write no new file format.
- Successful writes update page metadata, the selected document and cached details immediately, then refresh the shared workspace summary. Entering chart mode handles unsaved list drafts before graph writes to prevent a later stale save.
- Operation buttons disable during saves. Failures retain form values and show an error. Modal/form widths and scrolling follow existing Android responsive styles.

Verify root and nested insertion, all three fields, duplicate/empty titles, deleted parents, preserving changes saved before the action, removal/reparenting and trash behavior, dialog/form rendering, type checks and the full suite. Rebuild every distribution for 0.2.23 and verify versions and checksums.

## Verification

- Root/nested insertion, three-part fields, stale/duplicate/empty titles, reparenting with preserved details, and setting trash behavior passed against the real workspace storage implementation. Dialog/form rendering and tree/image regression tests passed (31 focused tests).
- Node and renderer TypeScript checks passed. Full suite: 207 files passed, 1130 tests passed, 5 skipped.
- Rebuilt Windows installer/portable ZIP, Android Debug/unsigned Release APK and unsigned Release AAB, and the standalone Linux server archive for 0.2.23 (Android versionCode 23).
- Verified source/stage/archive/Android metadata versions, Windows update manifest and installer SHA512, eight release SHA256 entries and five internal server manifest entries.
- Server archive SHA256: `c0e5f291489a3424751217b4a8238bcc3fb9552a69889bd3a5867a4aea36fe28`.
- No physical Android UI acceptance was performed. The tests cover storage behavior and rendering; the packages have been built and verified.
