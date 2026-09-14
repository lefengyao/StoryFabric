# Immersive Book Experience Implementation Plan

> For agentic workers: use executing-plans or subagent-driven-development to implement this plan task by task. Steps use checkboxes for tracking.

**Goal:** Add a performant book-and-library presentation layer to StoryFabric-web while preserving every existing page's content, controls, links and behavior.

**Architecture:** Keep the existing static multi-page site. Add a decorative scene layer and semantic content surface to each page, use CSS 3D for the heavy book, use local GSAP for timelines, and keep ordinary href navigation as the final fallback. Do not introduce a SPA or move business handlers out of the existing application.

**Tech Stack:** Static HTML, CSS 3D transforms, local GSAP 3.x, History API, sessionStorage, vanilla JavaScript and Node.js assertion-based QA.

---

## File map

- Create: StoryFabric-web/assets/vendor/gsap.min.js — pinned local GSAP browser build.
- Create: StoryFabric-web/assets/immersive/book-experience.css — book, library, page-surface, responsive and reduced-motion rules.
- Create: StoryFabric-web/assets/immersive/book-scene.js — shared book model, floating motion, pointer parallax, mount and teardown.
- Create: StoryFabric-web/assets/immersive/route-transition.js — navigation interception, route direction, transition lock, History metadata and fallback.
- Create: StoryFabric-web/assets/immersive/download-scene.js — close, shelve, camera pull-back and student placeholder motion.
- Create: StoryFabric-web/assets/immersive/student-placeholder.svg — labeled layered placeholder with head, body, eyes, arm and hand groups.
- Create: StoryFabric-web/assets/immersive/library-background.webp — compressed replaceable library placeholder.
- Create: StoryFabric-web/.qa/immersive-book-experience.test.cjs — static contracts for all six pages and asset hooks.
- Create: StoryFabric-web/.qa/immersive-book-runtime.test.cjs — pure route-helper and duration-budget contracts.
- Create: StoryFabric-web/docs/immersive-book-assets.md — resource list, placeholder status and replacement instructions.
- Modify: all six StoryFabric-web HTML pages — add scene attributes, script tags and wrappers only.
- Modify: StoryFabric-web/assets/app.js — call the immersive initializer after existing handlers.
- Modify: StoryFabric-web/assets/styles.css — add compatibility rules only.

## Task 1: Establish regression contracts

**Files:**
- Create: StoryFabric-web/.qa/immersive-book-experience.test.cjs
- Create: StoryFabric-web/.qa/immersive-book-runtime.test.cjs

- [ ] Step 1: Write the failing static test

Create immersive-book-experience.test.cjs with:

~~~
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const pages = ['index.html', 'workbench.html', 'world.html', 'agent.html', 'opensource.html', 'download.html']

for (const filename of pages) {
  const html = fs.readFileSync(path.join(root, filename), 'utf8')
  assert.match(html, /data-page="[^"]+"/)
  assert.match(html, /data-book-experience/)
  assert.match(html, /assets\/vendor\/gsap\.min\.js/)
  assert.match(html, /assets\/immersive\/book-scene\.js/)
  assert.match(html, /assets\/immersive\/route-transition\.js/)
  assert.match(html, /<main id="main" data-immersive-content>/)
}

const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
assert.match(home, /把散落的故事/)
assert.match(home, /data-book-home/)

const download = fs.readFileSync(path.join(root, 'download.html'), 'utf8')
assert.match(download, /data-book-download/)
assert.match(download, /data-release-root/)
assert.match(download, /data-download-empty/)
~~~

- [ ] Step 2: Write the failing route-helper test

Create immersive-book-runtime.test.cjs. Load route-transition.js into a vm context and assert that window.StoryFabricRouteTransition exposes getDirection and getTransitionMode, with home to workbench equal to forward, download to agent equal to backward, download equal to shelve and world equal to turn.

- [ ] Step 3: Run the tests and verify the expected red state

Run from StoryFabric-web:

~~~
node .qa\immersive-book-experience.test.cjs
node .qa\immersive-book-runtime.test.cjs
~~~

Expected: both commands fail because the immersive hooks and modules do not exist.

## Task 2: Add the shared scene and heavy book

**Files:**
- Create: StoryFabric-web/assets/vendor/gsap.min.js
- Create: StoryFabric-web/assets/immersive/book-experience.css
- Create: StoryFabric-web/assets/immersive/book-scene.js
- Modify: all six StoryFabric-web HTML pages
- Modify: StoryFabric-web/assets/app.js

- [ ] Step 1: Add scene hooks without changing content

In each page, add data-book-experience to body, add the decorative layer immediately before the existing main, add data-immersive-content to main, and load the local GSAP and immersive scripts with defer:

~~~
<body data-page="home" data-book-experience>
  <div class="book-scene-layer" aria-hidden="true" data-book-scene></div>
  <main id="main" data-immersive-content>
    <!-- existing page content remains in the same order -->
  </main>
</body>
~~~

Load download-scene.js only on download.html, before route-transition.js.

- [ ] Step 2: Implement the decorative book model

book-scene.js creates only decorative nodes for library backdrop, light pool, ground shadow, back cover, page block, left page, right page, spine, fore-edge and front cover. Expose mount, playHomeIntro, playTurnOut, playTurnIn, playShelveOut, playShelveIn, setReducedMotion and destroy on window.StoryFabricBookScene. The module must not read or mutate product copy.

- [ ] Step 3: Implement book depth and idle motion

Use perspective, transform-style preserve-3d, backface-visibility hidden, layered covers, repeating page-block edges, a gold spine and a blurred shadow. Start the model at rotateX 10deg, rotateY -8deg and rotateZ -7deg. GSAP may animate only transform, opacity, filter and CSS custom properties. Idle motion is y -8 to y 0, yoyo, duration 2.5 and ease sine.inOut; shadow scale and opacity follow the same timeline.

- [ ] Step 4: Connect the initializer safely

Append this guard after existing page initialization in assets/app.js:

~~~
if (window.StoryFabricBookScene && document.querySelector('[data-book-scene]')) {
  window.StoryFabricBookScene.mount()
}
~~~

If GSAP or a new module is missing, existing page behavior must continue.

- [ ] Step 5: Run shared scene checks

~~~
node .qa\immersive-book-experience.test.cjs
node --check assets\immersive\book-scene.js
node --check assets\app.js
~~~

Expected: all commands pass.

## Task 3: Implement homepage composition and intro

**Files:**
- Modify: StoryFabric-web/index.html
- Modify: StoryFabric-web/assets/immersive/book-experience.css
- Modify: StoryFabric-web/assets/immersive/book-scene.js
- Modify: StoryFabric-web/.qa/immersive-book-experience.test.cjs

- [ ] Step 1: Mark the existing hero

Add only data-book-home to the existing homepage hero section. Do not change its descendants or copy.

- [ ] Step 2: Implement the 1.8-second intro

Use one GSAP timeline: library opacity and filter from 0 to 0.4s; book opacity, y and rotation from 0.3 to 1.2s; left and right pages open from 0.9 to 1.5s; existing hero content moves up and fades from 1.2 to 1.8s. Existing text remains the source of truth and is never duplicated into JavaScript.

- [ ] Step 3: Add pointer parallax and scroll trigger

Clamp pointer tilt to ±5 degrees horizontally and ±3 degrees vertically. Animate the model with a short power2.out tween. At the first scroll threshold, scale the book by no more than 1.04 and trigger the first page-turn state once.

- [ ] Step 4: Verify homepage behavior

Add assertions for data-book-home, rotateY, power3.out and prefers-reduced-motion, then run:

~~~
node .qa\immersive-book-experience.test.cjs
node --check assets\immersive\book-scene.js
~~~

Expected: PASS.

## Task 4: Implement page-turn navigation and history

**Files:**
- Create/modify: StoryFabric-web/assets/immersive/route-transition.js
- Modify: StoryFabric-web/assets/immersive/book-scene.js
- Modify: all six StoryFabric-web HTML pages
- Modify: StoryFabric-web/.qa/immersive-book-runtime.test.cjs

- [ ] Step 1: Define pure route helpers

Use the fixed route order home, workbench, world, agent, opensource, download. getDirection returns forward when the target index is greater than or equal to the source index and backward otherwise. getTransitionMode returns shelve for download and turn for every other known page. Export both helpers before DOM-dependent code.

- [ ] Step 2: Intercept only safe same-origin links

Intercept only primary-click, same-origin, known-page links without modifiers, target blank, download attributes, hash-only destinations or external GitHub CTAs. Store from, to, direction, mode and createdAt in sessionStorage. Set a module lock and aria-busy true, play the outgoing animation, then navigate to the original href. If GSAP, the scene or a resource is unavailable, clear the lock and navigate immediately.

- [ ] Step 3: Implement the 1.6 to 2.0 second page turn

Animate a page-curl custom property for 0.25s, page segments from right to left for about 0.9s with a small stagger, and old content opacity/y for about 0.25s. Reverse rotation for backward navigation. Target content entrance begins after the target document loads and uses group delays of about 100ms.

- [ ] Step 4: Restore incoming and browser history state

On pageshow, read valid transition data no older than 15 seconds. Use popstate for same-document state and pageshow/navigation type for full document traversal. If direction is unknown, use a 400ms fade. Always clear aria-busy and the lock after success or failure.

- [ ] Step 5: Run route checks

~~~
node .qa\immersive-book-runtime.test.cjs
node --check assets\immersive\route-transition.js
node --check assets\immersive\book-scene.js
~~~

Expected: PASS.

## Task 5: Implement download-page shelve scene

**Files:**
- Create: StoryFabric-web/assets/immersive/download-scene.js
- Create: StoryFabric-web/assets/immersive/student-placeholder.svg
- Create: StoryFabric-web/assets/immersive/library-background.webp
- Create: StoryFabric-web/docs/immersive-book-assets.md
- Modify: StoryFabric-web/download.html
- Modify: StoryFabric-web/assets/immersive/book-experience.css
- Modify: StoryFabric-web/.qa/immersive-book-experience.test.cjs

- [ ] Step 1: Add download scene hooks

Add only decorative children inside the scene layer:

~~~
<div class="book-scene-layer" aria-hidden="true" data-book-scene data-book-download>
  <div data-library-shelf></div>
  <div data-library-desk></div>
  <div data-library-lamp></div>
  <img src="assets/immersive/student-placeholder.svg" alt="" data-student />
</div>
~~~

Keep data-release-root, data-latest-actions, data-release-history, all download text and every existing control unchanged.

- [ ] Step 2: Implement the 3.6-second timeline

Use phase boundaries of 0 to 1.0s for page close, 1.0 to 1.8s for book movement to the shelf, 1.5 to 1.9s for shelf highlight and adjacent-book shake, 1.8 to 3.0s for camera pull-back, 2.4 to 3.2s for the student gesture and 3.0 to 3.6s for download-content entrance. Animate transform, opacity and filter only.

- [ ] Step 3: Implement the layered placeholder motion

The SVG contains student-head, student-body, student-eyes, student-arm and student-hand. Animate breathing between 0 and -2px over 2.8s, a 0.12s blink every 4.5s and an open-palm gesture from 2.4s to 3.2s. Disable loops when reduced motion is active. Label the asset as replaceable in immersive-book-assets.md.

- [ ] Step 4: Add download regression assertions

Assert that download.html has data-book-download, data-release-root and the existing empty state, and that download-scene.js contains 3.6, data-student and prefers-reduced-motion.

- [ ] Step 5: Run download checks

~~~
node .qa\download-page.test.cjs
node .qa\immersive-book-experience.test.cjs
node --check assets\immersive\download-scene.js
~~~

Expected: all commands pass.

## Task 6: Add responsive, accessibility, performance and final verification

**Files:**
- Modify: all three immersive JavaScript modules and book-experience.css
- Modify: StoryFabric-web/.qa/immersive-book-experience.test.cjs
- Modify: StoryFabric-web/docs/immersive-book-assets.md

- [ ] Step 1: Add one shared simple-motion predicate

Use reduced-motion media query plus deviceMemory and hardwareConcurrency thresholds of 2. When simpleMotion is true, skip continuous float, pointer parallax, page-strip bending, shelf shake and student idle loops. Use a 400ms fade for navigation and a 700ms close/fade sequence for download.

- [ ] Step 2: Add responsive rules

At max-width 960px reduce library depth and center the book. At max-width 620px keep the book at least 88vw, hide nonessential shelf layers, use a single-column content surface and retain core page turning. Keep the existing mobile menu as the only navigation control.

- [ ] Step 3: Add accessibility and failure checks

Assert decorative layers use aria-hidden true, the student image uses an empty alt attribute, and route code contains the original-href fallback. Verify aria-busy is cleared after successful and failed transitions.

- [ ] Step 4: Run the complete suite

~~~
node .qa\download-page.test.cjs
node .qa\opensource-page.test.cjs
node .qa\immersive-book-experience.test.cjs
node .qa\immersive-book-runtime.test.cjs
node --check assets\app.js
node --check assets\immersive\book-scene.js
node --check assets\immersive\route-transition.js
node --check assets\immersive\download-scene.js
~~~

Expected: all commands exit with code 0.

- [ ] Step 5: Verify static routes and content

Start server.mjs on an available local port and request the six HTML pages, book-experience.css and healthz. Every route must return 200. Confirm the download page still exposes data-release-root, data-latest-actions and the 敬请期待 empty fallback.

- [ ] Step 6: Perform browser verification

At 1280px, 768px and 375px widths verify book depth and intro, pointer clamp, one-click navigation lock, forward/backward turns, browser Back/Forward, download close/shelve/pull-back/student/content sequence, reduced-motion behavior, console errors and horizontal overflow. If the browser environment is unavailable, record that limitation and retain static/server evidence.

- [ ] Step 7: Inspect the final change set

Confirm existing text, button labels, links, version fields, download filenames and feature handlers were not deleted or rewritten. The only existing-page structural changes may be scene attributes, script tags, scene wrappers and the initializer guard.
