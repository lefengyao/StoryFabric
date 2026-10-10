import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { flattenCssLayers } from './src/shared/build/mobileCss'
import { vendorManualChunks } from './vite.chunking'

/**
 * Android 10 ships Chromium 83, which predates CSS cascade layers.
 * Tailwind 4 emits its theme/base/utilities inside @layer blocks; Chromium
 * 83 ignores the complete block, leaving controls with browser defaults.
 * Flatten only the generated CSS layers for the mobile bundle so the same
 * source styles continue to work on desktop and modern Android WebViews.
 */
function legacyMobileCss() {
  return {
    name: 'legacy-mobile-css',
    generateBundle(_options: unknown, bundle: Record<string, { type: string; fileName: string; source?: string | Uint8Array }>) {
      for (const asset of Object.values(bundle)) {
        if (asset.type !== 'asset' || typeof asset.source !== 'string' || !asset.fileName.endsWith('.css')) continue
        asset.source = flattenCssLayers(asset.source)
      }
    }
  }
}

/** Capacitor Android 使用的纯 Web 构建配置，不包含 Electron main/preload。 */
export default defineConfig({
  worker: { format: 'es' },
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
    target: 'es2019',
    rollupOptions: {
      output: { manualChunks: vendorManualChunks }
    }
  }
})
