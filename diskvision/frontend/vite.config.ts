import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/map/',
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/map/api': {
        target: 'http://127.0.0.1:5002',
        changeOrigin: true,
        rewrite: p => p.replace(/^\/map\/api/, ''),
      },
    },
  },
})