import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

// In the Docker dev overlay, VITE_API_TARGET is injected via docker-compose.dev.yml
// as 'http://soc-backend:8000' (Docker internal DNS). When running `npm run dev`
// locally on the host (outside Docker), it falls back to localhost:18000.
const API_TARGET = process.env.VITE_API_TARGET ?? 'http://localhost:18000'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // This proxy mirrors what Nginx does in production:
    // All /api/* requests from the browser are forwarded to the FastAPI backend.
    // Without this, localhost:5173/api/* returns 404 (Vite only serves static assets).
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        // Disable SSL verification for local dev
        secure: false,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: false,
  },
})

