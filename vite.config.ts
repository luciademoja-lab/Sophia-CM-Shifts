import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app lives in frontend/; shared code (username rules) lives in backend/supabase/functions/_shared.
// `--mode e2e` (npm run test:e2e) forces demo mode, even when .env.local holds Supabase keys.
export default defineConfig(({ mode }) => ({
  root: 'frontend',
  envDir: '..',
  plugins: [react()],
  server: { port: 5173, fs: { allow: ['..'] } },
  preview: { port: 4173 },
  build: { outDir: '../dist', emptyOutDir: true },
  define: mode === 'e2e'
    ? { 'import.meta.env.VITE_SUPABASE_URL': '""', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '""' }
    : {},
}));
