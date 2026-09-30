# Setting Mind Map and Notes Design

## Goal

Represent every setting and nested tag as a three-part node: title, short summary, and detailed Markdown content. The chart shows the first two parts; detail opens from a node or in a text view. PNG export can include all nonempty details as numbered notes beneath the chart or export the chart alone.

## Data and compatibility

- A setting document keeps its existing `title` and Markdown `content` fields and gains an optional `summary`.
- A tag keeps its existing name in `tags`, parent in `tagParents`, and gains optional `tagDetails[name] = { summary, content }`. This avoids changing existing hierarchy IDs and file paths.
- Missing fields in old projects mean empty summary/detail. No content is inferred from old titles or Markdown. Removing a tag also removes its detail entry; invalid detail keys are rejected on save.
- The agent `save_setting` schema and prompt expose the new fields, preserving the same approval and revision flow as other setting edits.

## UI and export

- Render the focused tree as a warm yellow mind map with curved branches. Nodes show a bold title and a wrapped summary. Node and subtree heights grow with summary length to prevent overlapping branches. The root has a filled accent label. The viewport itself remains pannable and zoomable.
- Clicking any node opens a readable detail dialog. A text view lists the same focused tree in hierarchy order with all three parts, loading setting bodies only when needed. Existing list mode remains the editor; each tag gets a detail editor in the hierarchy panel.
- Export defaults to `include notes`. Notes are numbered in tree order and placed after the graph in the PNG. The user can turn notes off to export only the diagram. The SVG generator escapes user text and wraps every detail line; the PNG path preserves the existing bounded-canvas behavior.

## Verification

Test persisted old and new fields, agent write/schema behavior, tree node projection, text view data, SVG notes on/off and escaping, and PNG generation. Run renderer type checks and the full test suite. Rebuild the Linux bundle and desktop/mobile distributions for the versioned release.
