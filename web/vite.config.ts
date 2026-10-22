import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './',
  // Single source of truth: load env (incl. VITE_OAUTH_*) from the repo-root .env.
  envDir: '..',
  plugins: [react(), tailwindcss()],
  // dev proxies API + git to the node server (must match its PORT, default 3001)
  server: { port: 5173, proxy: { '/api': 'http://localhost:3001', '/git': 'http://localhost:3001' } },
  build: { outDir: 'dist', emptyOutDir: true },
});
