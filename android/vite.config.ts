import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
export default defineConfig({
  root: '.', base: '/',
  define: { 'process.platform': JSON.stringify('android') },
  resolve: { alias: { '@': resolve('src/renderer/src'), '@shared': resolve('src/shared'), electron: resolve('src/android/rendererBridge.ts') } },
  plugins: [react()],
  build: { target: 'es2020', outDir: 'android/app/src/main/assets/ui', emptyOutDir: true, rollupOptions: { input: 'android/index.html' } }
})
