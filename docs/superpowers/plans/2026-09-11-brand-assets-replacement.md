# StoryFabric Brand Assets Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old embedded StoryFabric logo across the renderer and platform assets using the three supplied SVGs, with a reusable colorable mono mark and regenerated Electron/Android icons.

**Architecture:** Keep the three root SVGs as the design sources. The renderer will expose one `BrandMark` component that loads the flat asset as an image and the mono asset as a CSS mask so callers can control color and opacity. The existing icon generator will consume the release SVG and emit Windows and Android raster assets, while existing platform configuration continues to reference generated files.

**Tech Stack:** React 19, Vite/electron-vite, TypeScript, CSS mask-image, Sharp, png-to-ico, Capacitor Android resources, Vitest.

---

### Task 1: Add a shared renderer brand component

**Files:**
- Create: `src/renderer/src/components/icons/BrandMark.tsx`
- Create: `src/renderer/src/components/icons/__tests__/BrandMark.test.tsx`
- Delete after migration: `src/renderer/src/components/icons/AppLogo.tsx`
- Read as source: `storyfabric-logo-flat.svg`, `storyfabric-logo-mono.svg`

- [ ] **Step 1: Write the failing component tests**

  Test the public behavior rather than implementation details:

  ```tsx
  it('renders the flat asset with the requested size and accessible label', () => {
    render(<BrandMark variant="flat" size={52} />)
    const image = screen.getByRole('img', { name: '织章 StoryFabric' })
    expect(image).toHaveAttribute('width', '52')
    expect(image).toHaveAttribute('height', '52')
    expect(image.getAttribute('src')).toContain('storyfabric-logo-flat')
  })

  it('renders mono as a colorable mask', () => {
    render(<BrandMark variant="mono" size={80} style={{ color: '#b8862e', opacity: 0.4 }} />)
    const mark = screen.getByRole('img', { name: '织章 StoryFabric' })
    expect(mark).toHaveAttribute('aria-hidden', 'false')
    expect(mark.getAttribute('style')).toContain('color: rgb(184, 134, 46)')
    expect(mark.getAttribute('style')).toContain('mask-image')
    expect(mark.getAttribute('style')).toContain('storyfabric-logo-mono')
  })
  ```

  Keep the test compatible with the repository's existing Vitest/jsdom setup; if no DOM matcher is available, assert against `container.querySelector` and attributes directly.

- [ ] **Step 2: Run the focused test and verify it fails**

  Run:

  ```powershell
  npx vitest run src/renderer/src/components/icons/__tests__/BrandMark.test.tsx
  ```

  Expected: FAIL because `BrandMark` does not exist yet.

- [ ] **Step 3: Implement the minimal `BrandMark` API**

  Define `variant: 'flat' | 'mono'`, `size?: number`, `className?: string`, `style?: CSSProperties`, and `aria-label?: string`. Import the two SVGs as Vite URLs. Render `flat` with `<img>` and render `mono` as a span/div with `maskImage` and `WebkitMaskImage` set to the mono URL, `backgroundColor: 'currentColor'`, `width`/`height` set from `size`, and role/label set for accessibility. Preserve caller style values while setting only the mask and dimensions required by the component.

- [ ] **Step 4: Run the focused test and verify it passes**

  Run the same Vitest command. Expected: PASS.

- [ ] **Step 5: Commit the component**

  ```powershell
  git add src/renderer/src/components/icons/BrandMark.tsx src/renderer/src/components/icons/__tests__/BrandMark.test.tsx
  git commit -m "feat: add unified brand mark component"
  ```

### Task 2: Migrate renderer brand entry points and favicon

**Files:**
- Modify: `src/renderer/src/layouts/AppLayout.tsx`
- Modify: `src/renderer/src/pages/welcome/WelcomePage.tsx`
- Modify: `src/renderer/src/pages/webLogin/WebLoginPage.tsx`
- Modify: `src/renderer/index.html`
- Modify or delete: `src/renderer/src/components/icons/AppLogo.tsx`
- Test: `src/renderer/src/components/icons/__tests__/BrandMark.test.tsx`

- [ ] **Step 1: Replace all `AppLogo` imports and calls**

  Use `<BrandMark variant="flat" ... />` at the existing sidebar, welcome, and web-login positions, preserving their existing size, class names, layout, and accessible label. Do not add a new watermark placement.

- [ ] **Step 2: Add the flat favicon**

  Add a `<link rel="icon" type="image/svg+xml" href="...storyfabric-logo-flat.svg" />` entry that resolves in the Vite renderer build. Use the same stable asset import/public path strategy used by `BrandMark`; do not point production HTML at a development-only filesystem path.

- [ ] **Step 3: Remove the obsolete embedded logo**

  Delete `AppLogo.tsx` after `rg -n "AppLogo|applogo-|#6366f1|#4338ca" src/renderer` confirms no old logo implementation or import remains. Keep unrelated use of the application accent colors untouched.

- [ ] **Step 4: Run renderer type checks and a reference scan**

  Run:

  ```powershell
  npx tsc --noEmit
  rg -n "AppLogo|applogo-bg|applogo-ribbon" src/renderer
  ```

  Expected: TypeScript passes and the reference scan returns no old logo implementation or imports.

- [ ] **Step 5: Commit the renderer migration**

  ```powershell
  git add src/renderer/src/layouts/AppLayout.tsx src/renderer/src/pages/welcome/WelcomePage.tsx src/renderer/src/pages/webLogin/WebLoginPage.tsx src/renderer/index.html src/renderer/src/components/icons
  git commit -m "feat: replace renderer logo with brand assets"
  ```

### Task 3: Regenerate Electron and Android icon assets from the release SVG

**Files:**
- Modify: `scripts/generate-icons.mjs`
- Modify: `package.json` only if a dedicated `brand:icons` script is needed
- Modify generated files: `resources/icon.ico`, `resources/icon-256.png`, `resources/icon-preview.png`
- Modify generated Android files: `android/app/src/main/res/mipmap-*/ic_launcher*.png`
- Modify: `android/app/src/main/res/drawable/ic_launcher_background.xml`
- Modify: `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`
- Modify: `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml`

- [ ] **Step 1: Extend the icon generator tests/contract**

  Before changing the generator, assert its input/output contract with a small Node-level test or deterministic post-generation checks: the source must be `storyfabric-logo.svg`, the Windows outputs must be non-empty, and each Android density (`mdpi`, `hdpi`, `xhdpi`, `xxhdpi`, `xxxhdpi`) must receive launcher, round, and foreground PNGs.

- [ ] **Step 2: Update the generator source and output map**

  Change `scripts/generate-icons.mjs` to read `storyfabric-logo.svg` instead of `resources/icon.svg`. Keep the existing ICO sizes and preview output. Use Sharp to render the release SVG at the Android density sizes (48, 72, 96, 144, 192 pixels) and write the three required PNG names for each density. Keep output generation deterministic and fail fast when the source SVG is missing.

- [ ] **Step 3: Align adaptive icon resources**

  Set the Android adaptive icon background to the release mark's dark background color and point the adaptive foreground at the generated foreground PNG. Preserve both normal and round launcher XML references so Android 8+ and legacy Android use the same new mark.

- [ ] **Step 4: Generate and inspect the outputs**

  Run:

  ```powershell
  node scripts/generate-icons.mjs
  ```

  Expected: the Windows files and all Android density files are rewritten without errors. Check dimensions and non-zero file sizes with a short Node/PowerShell inspection before committing.

- [ ] **Step 5: Commit the regenerated platform assets**

  ```powershell
  git add scripts/generate-icons.mjs resources android/app/src/main/res
  git commit -m "feat: regenerate platform icons from release logo"
  ```

### Task 4: Verify all brand references and builds

**Files:**
- No planned source changes; only fix findings in the files above.
- Inspect: `src/renderer`, `resources`, `android/app/src/main/res`, `electron-builder.yml`, `src/main/index.ts`

- [ ] **Step 1: Run repository-wide brand scans**

  Run:

  ```powershell
  rg -n --hidden --glob '!node_modules' --glob '!out' --glob '!dist-server' "AppLogo|applogo-|resources/icon\.svg|storyfabric-logo-(flat|mono)|storyfabric-logo\.svg" src resources android electron-builder.yml scripts
  ```

  Expected: renderer references use `BrandMark`/flat/mono assets, Electron release paths resolve to generated `resources/icon.*`, and no old embedded logo remains.

- [ ] **Step 2: Run tests and type checks**

  ```powershell
  npx vitest run
  npx tsc --noEmit
  npx tsc --noEmit -p tsconfig.web.json
  ```

  Expected: all tests pass; both TypeScript checks exit 0.

- [ ] **Step 3: Run all four builds**

  ```powershell
  npm run build
  npm run web:build
  npm run mobile:build
  npm run server:build
  ```

  Expected: Electron, Web, Mobile, and Server builds complete successfully.

- [ ] **Step 4: Check the diff and platform references**

  ```powershell
  git diff --check HEAD~3..HEAD
  git status --short
  ```

  Expected: no whitespace errors. Existing unrelated user modifications remain untouched and are reported separately from this feature.

- [ ] **Step 5: Commit any narrowly scoped fixes**

  If verification finds a brand-replacement issue, add a focused test first, fix only the affected asset/component/configuration, rerun the failing command, and commit with a message such as `fix: complete brand asset replacement verification`.
