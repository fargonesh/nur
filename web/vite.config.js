import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  // dev proxies API + git to the node server (must match its PORT, default 3001)
  server: { port: 5173, proxy: { '/api': 'http://localhost:3001', '/git': 'http://localhost:3001' } },
  build: { outDir: 'dist', emptyOutDir: true },
});
