import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: resolve(__dirname, 'src/server/index.ts'),
    outDir: resolve(__dirname, 'dist-server'),
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: {
      output: {
        format: 'es',
        entryFileNames: 'index.mjs'
      }
    }
  },
  ssr: {
    noExternal: true
  }
})
