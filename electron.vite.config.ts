import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = resolve(__dirname, 'src/shared')

function git(args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch {
    return ''
  }
}

const packageJson = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as {
  version: string
}
const gitSha =
  process.env.HARBORLIGHT_GIT_SHA || git(['rev-parse', '--short=12', 'HEAD']) || 'unknown'
const gitDirty =
  process.env.HARBORLIGHT_GIT_DIRTY === '1' || git(['status', '--porcelain']).length > 0

/** Build metadata surfaced in Settings and by `harborlight --version`. */
const buildDefines = {
  __APP_VERSION__: JSON.stringify(packageJson.version),
  __GIT_SHA__: JSON.stringify(gitSha),
  __GIT_DIRTY__: JSON.stringify(gitDirty),
  __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  __UPDATE_CHANNEL__: JSON.stringify(process.env.HARBORLIGHT_CHANNEL ?? 'stable')
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: buildDefines,
    resolve: {
      alias: { '@shared': shared, '@main': resolve(__dirname, 'src/main') }
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    define: buildDefines,
    resolve: {
      alias: { '@shared': shared }
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), tailwindcss()],
    define: buildDefines,
    resolve: {
      alias: { '@': resolve(__dirname, 'src/renderer'), '@shared': shared }
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    }
  }
})
