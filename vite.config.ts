import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    // Opt-in: GRIPLOCK_DEV_API=http://127.0.0.1:8080 npm run dev (with npm run dev:server running)
    proxy: process.env.GRIPLOCK_DEV_API ? Object.fromEntries(['/api', '/auth', '/dev-auth', '/runtime-config.js']
      .map(path => [path, process.env.GRIPLOCK_DEV_API as string])) : undefined,
  },
  preview: { proxy: {} },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-recharts': ['recharts'],
          'vendor-supabase': ['@supabase/supabase-js'],
        },
      },
    },
  },
})
