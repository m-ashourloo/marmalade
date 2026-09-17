import { cp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const PDFJS = resolve(__dirname, 'node_modules/pdfjs-dist')

/**
 * pdf.js loads these data directories at runtime; without them CJK documents and
 * some embedded-font documents render blank glyphs.
 *
 * Done with fs.cp rather than a glob-based copy plugin because the project path
 * may contain spaces and backslashes, which fast-glob does not handle.
 */
function copyPdfjsAssets(): Plugin {
  return {
    name: 'copy-pdfjs-assets',
    apply: 'build',
    async writeBundle(options) {
      const outDir = options.dir ?? resolve(__dirname, 'out/renderer')
      for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
        await cp(resolve(PDFJS, dir), resolve(outDir, 'pdfjs', dir), {
          recursive: true,
          force: true
        })
      }
    }
  }
}

/**
 * Puts the app icon next to the built main bundle.
 *
 * `build/` is electron-builder's buildResources directory, which it excludes from
 * the packaged files, so the icon has to be copied somewhere under `out/` for
 * BrowserWindow to load it at runtime. No `apply` — unlike the renderer, main is
 * bundled in dev too, and the dev window should carry the icon as well.
 */
function copyAppIcon(): Plugin {
  return {
    name: 'copy-app-icon',
    async writeBundle(options) {
      const outDir = options.dir ?? resolve(__dirname, 'out/main')
      await cp(resolve(__dirname, 'build/icon.png'), resolve(outDir, 'icon.png'), { force: true })
    }
  }
}

/** The same assets, served straight from node_modules during `dev`. */
function servePdfjsAssets(): Plugin {
  return {
    name: 'serve-pdfjs-assets',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const match = /^\/pdfjs\/([^?]+)/.exec(req.url ?? '')
        if (!match) return next()
        const file = resolve(PDFJS, decodeURIComponent(match[1]))
        if (!file.startsWith(PDFJS)) return next()
        import('node:fs')
          .then(({ createReadStream, existsSync }) => {
            if (!existsSync(file)) return next()
            createReadStream(file).pipe(res)
          })
          .catch(next)
      })
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyAppIcon()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    plugins: [react(), copyPdfjsAssets(), servePdfjsAssets()],
    build: {
      // The pdf.js worker is legitimately ~2 MB; the warning is noise here.
      chunkSizeWarningLimit: 3000,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    }
  }
})
