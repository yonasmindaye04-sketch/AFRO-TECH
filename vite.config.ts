import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001'   // forwards API calls to your backend
    }
  },
  base: '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) {
              return 'react-vendor';
            }
            if (id.includes('lenis')) {
              return 'lenis';
            }
            return 'vendor';
          }
        }
      }
    },
    // Enable CSS code splitting
    cssCodeSplit: true,
    // Minify with esbuild
    minify: 'esbuild',
    // Target modern browsers for smaller bundles
    target: 'es2020',
    // No sourcemaps in production
    sourcemap: false,
  },
})