import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') }
  },
  build: {
    outDir: 'dist'
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:7842',
      '/ws': { target: 'ws://localhost:7842', ws: true, rewriteWsOrigin: true },
    }
  }
})
