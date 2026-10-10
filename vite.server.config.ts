import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [{
    name: 'standalone-pdf-worker',
    async generateBundle() {
      // The bundled pdf.js Node entrypoint imports this sibling for text parsing.
      this.emitFile({ type: 'asset', fileName: 'assets/pdf.worker.mjs', source: await readFile(resolve(__dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs')) })
    }
  }],
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
