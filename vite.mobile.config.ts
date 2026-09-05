import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Android 10 ships Chromium 83, which predates CSS cascade layers.
 * Tailwind 4 emits its theme/base/utilities inside @layer blocks; Chromium
 * 83 ignores the complete block, leaving controls with browser defaults.
 * Flatten only the generated CSS layers for the mobile bundle so the same
 * source styles continue to work on desktop and modern Android WebViews.
 */
function flattenCssLayers(css: string): string {
  let result = ''
  let cursor = 0

  while (cursor < css.length) {
    const start = css.indexOf('@layer', cursor)
    if (start < 0) {
      result += css.slice(cursor)
      break
    }

    const open = css.indexOf('{', start)
    if (open < 0) {
      result += css.slice(cursor)
      break
    }

    // Keep text before the at-rule, then copy the layer body without its
    // wrapper. Nested @media/@supports blocks remain intact.
    result += css.slice(cursor, start)
    let depth = 1
    let close = open + 1
    for (; close < css.length && depth > 0; close += 1) {
      if (css[close] === '{') depth += 1
      else if (css[close] === '}') depth -= 1
    }

    if (depth !== 0) {
      // Malformed/unexpected CSS: preserve the original tail rather than
      // emitting a truncated stylesheet.
      result += css.slice(start)
      break
    }

    result += css.slice(open + 1, close - 1)
    cursor = close
  }

  return result
}

function legacyMobileCss() {
  return {
    name: 'legacy-mobile-css',
    generateBundle(_options: unknown, bundle: Record<string, { type: string; source?: string | Uint8Array }>) {
      for (const asset of Object.values(bundle)) {
        if (asset.type !== 'asset' || typeof asset.source !== 'string' || !asset.fileName.endsWith('.css')) continue
        asset.source = flattenCssLayers(asset.source)
      }
    }
  }
}

/** Capacitor Android 使用的纯 Web 构建配置，不包含 Electron main/preload。 */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react(), tailwindcss(), legacyMobileCss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src')
    }
  },
  build: {
    outDir: resolve(__dirname, 'out/mobile'),
    emptyOutDir: true,
    // Vivo 真机当前为 Android 10，系统 WebView 不支持 ||= 等较新的
    // 逻辑赋值语法；显式降级目标，确保依赖包也被转译。
    target: 'es2019'
  }
})
