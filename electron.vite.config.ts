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
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          // The licence gate and splash run before the app and get a bridge of
          // their own, far narrower than the one the renderer receives.
          boot: resolve(__dirname, 'src/preload/boot.ts')
        },
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
      // The splash has to paint on the first frame, so its artwork is inlined
      // as a data URL rather than fetched. That also keeps it inside the
      // existing `img-src 'self' data:` policy with no CSP change.
      assetsInlineLimit: (filePath: string) => (filePath.endsWith('splash.jpg') ? true : undefined),
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          splash: resolve(__dirname, 'src/renderer/splash.html'),
          license: resolve(__dirname, 'src/renderer/license.html')
        }
      }
    }
  }
})
