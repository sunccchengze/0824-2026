import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { host: true, port: 5173, allowedHosts: true },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          if (id.includes('node_modules') && (id.includes('/three/') || id.includes('@react-three'))) return 'three'
        },
      },
    },
  },
})
