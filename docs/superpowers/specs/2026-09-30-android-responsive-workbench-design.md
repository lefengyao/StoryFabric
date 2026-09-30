# Android Responsive Workbench Design

## Goal

Make every Android page fit the visible width in portrait and landscape while retaining the desktop app's typography, colors, information hierarchy, and navigation model. The document/page shell must never require horizontal scrolling. Graph and timeline canvases may pan internally.

## Approved layout

The user selected the compact workbench (option A), closest to the PC interface.

- Landscape: a persistent 48 px icon rail, 156 px document or session list where a page has one, and the remaining width for the main content. The agent panel opens over the right edge at no more than 300 px instead of reducing the main content width.
- Portrait: navigation and chat sessions remain drawers. Document lists use a short, vertically scrollable panel above the content so the editor remains visible. Edit inspectors for graphs cover the content rather than creating a wider row.
- Both orientations: the app header stays on one line, truncates long workspace names, and preserves safe-area padding. Buttons, selects, cards, tables, and forms wrap within their owning page.

## Components and boundaries

- `AppLayout` owns Android navigation rail and header behavior. Desktop sidebar preferences remain unchanged.
- `ChatSidebar` owns its right overlay sizing on Android; `ChatPage` owns its compact session list.
- A small shared Android layout stylesheet, scoped by `.android-native`, defines shell widths and pane rules. Pages opt into list or inspector styling with semantic data attributes rather than relying on their DOM position or Tailwind's desktop breakpoints.
- Character, chapter, outline, setting, and note pages mark their left list panes. Event and relation pages mark their edit inspectors. Other pages retain their content flow and get targeted narrow-screen wrapping only where a control can force overflow.
- The graph/timeline scroll container remains the sole horizontal pan area on its page.

## Responsiveness and visual quality

Use orientation and available CSS width, not device model detection. Avoid unsupported CSS features in Android 10 WebView. Keep the current desktop palette and component language; reduce Android landscape padding and spacing instead of introducing a second design system. Controls remain at least 40 px high where tapped.

## Verification

- At approximately 360×710, 710×360, 800×360, and 1024×600 CSS px, every route's document and app shell satisfy `scrollWidth <= clientWidth`.
- Opening navigation, sessions, agent chat, and graph inspectors does not widen the page. Closing an overlay returns focus to the underlying workbench.
- Build the mobile bundle, confirm the Android 10 CSS compatibility transform still removes `@layer`, then sync and compile the Debug APK. Test on a connected Android 10 device if one becomes available; otherwise report that device-level validation remains pending.
- Run renderer tests, type checks, and the relevant release builds for code shipped to Windows and the Linux web bundle.
