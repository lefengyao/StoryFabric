import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { vendorManualChunks } from './vite.chunking'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src')
    }
  },
  build: {
    outDir: resolve(__dirname, 'out/web'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      output: { manualChunks: vendorManualChunks }
    }
  }
})
