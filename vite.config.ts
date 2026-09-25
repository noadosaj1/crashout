import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  // Rapier ships as a wasm-compat bundle; keep it out of the main chunk so the
  // menu paints before the physics engine finishes downloading.
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          if (id.includes('@dimforge/rapier3d-compat')) return 'rapier'
          if (id.includes('node_modules/three')) return 'three'
          return undefined
        },
      },
    },
  },
  server: { host: true },
})
