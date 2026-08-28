import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Browser-only development server.
 *
 * The renderer is web-first and portable: with `HARBORLIGHT_WEB=1` it runs in a
 * plain browser against the in-renderer mock transport. Real Docker access is
 * never available here because it requires the Electron preload bridge.
 */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react(), tailwindcss()],
  define: {
    'import.meta.env.HARBORLIGHT_WEB': JSON.stringify('1')
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  server: { port: 5199, strictPort: false }
})
