import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const alias = {
  '@': resolve(__dirname, 'src/renderer'),
  '@shared': resolve(__dirname, 'src/shared'),
  '@main': resolve(__dirname, 'src/main')
}

export default defineConfig({
  test: {
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/renderer/**/*.d.ts']
    },
    projects: [
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
          // Keeps the main-process logger from writing to the test output.
          env: { HARBORLIGHT_QUIET: '1' }
        }
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'renderer',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['tests/renderer/setup.ts'],
          include: ['tests/renderer/**/*.test.{ts,tsx}']
        }
      }
    ]
  }
})
