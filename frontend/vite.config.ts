import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import viteImagemin from 'vite-plugin-imagemin'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    viteImagemin({
      gifsicle: { optimizationLevel: 3 },
      mozjpeg: { quality: 80 },
      pngquant: { quality: [0.8, 0.9], speed: 4 },
      webp: { quality: 85 }
    })
  ],
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