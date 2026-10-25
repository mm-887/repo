import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // These are only reached through lazy chunks (graph view, answer rendering). If the dev server discovers a
  // dependency late it re-optimizes and force-reloads the page, wiping the conversation mid-use.
  optimizeDeps: {
    include: [
      'sigma',
      'sigma/types',
      'graphology',
      'graphology-layout-forceatlas2',
      'graphology-layout-forceatlas2/worker',
      'react-markdown',
      'remark-gfm',
    ],
  },
  server: {
    // Same-origin access to the FastAPI backend: /api/foo -> http://127.0.0.1:8000/foo
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
