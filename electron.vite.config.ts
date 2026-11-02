import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Salida en dist/ para no chocar con out/ de Electron Forge.
export default defineConfig({
  main: {
    build: { outDir: 'dist/main', rollupOptions: { input: resolve('src/main/index.ts') } }
  },
  preload: {
    build: { outDir: 'dist/preload', rollupOptions: { input: resolve('src/preload/index.ts') } }
  },
  renderer: {
    root: 'src/renderer',
    build: { outDir: resolve('dist/renderer'), rollupOptions: { input: resolve('src/renderer/index.html') } },
    plugins: [react()]
  }
})
