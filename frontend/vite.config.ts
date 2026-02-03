import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(),tailwindcss(),],
  server: {
    proxy: {
      '/api': {
        //@ts-ignore
        target: process.env.VITE_BACKEND_URL || 'http://localhost:8000',
        changeOrigin: true
      }
    }
  }
})