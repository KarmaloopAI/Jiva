import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            sourcemap: true,
            rollupOptions: {
              // Externalize everything that should not be bundled:
              // - electron (native)
              // - jiva-core (ESM package — loaded via dynamic import at runtime)
              // - Node.js built-ins
              external: [
                'electron',
                'jiva-core',
                /^node:/,
                'path', 'fs', 'os', 'child_process', 'events', 'crypto', 'url',
                'http', 'https', 'net', 'stream', 'util', 'buffer', 'process',
                'module', 'assert', 'tty', 'readline',
              ],
              output: { format: 'cjs' }
            }
          }
        }
      },
      {
        // Preload must be CJS — Electron loads it via require()
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            sourcemap: true,
            rollupOptions: {
              external: ['electron'],
              output: { format: 'cjs', entryFileNames: '[name].js' }
            }
          }
        }
      }
    ]),
    renderer()
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  build: {
    outDir: 'dist'
  }
})
