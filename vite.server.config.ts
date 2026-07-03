import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  build: {
    outDir: 'dist-server',
    lib: {
      entry: path.resolve(__dirname, 'server/index.ts'),
      formats: ['cjs'],
      fileName: () => 'index.js',
    },
    sourcemap: true,
    rollupOptions: {
      external: [
        'jiva-core',
        /^node:/,
        'path', 'fs', 'os', 'child_process', 'events', 'crypto', 'url',
        'http', 'https', 'net', 'stream', 'util', 'buffer', 'process',
        'module', 'assert', 'tty', 'readline', 'zlib',
        'express', 'ws', 'open', 'multer',
      ],
    },
  },
})
