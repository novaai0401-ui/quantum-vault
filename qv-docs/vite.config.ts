import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static-site build: output goes to dist/, consumable by any static host
// (Render, Netlify, Cloudflare Pages, GitHub Pages, plain nginx).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2020',
  },
  server: { port: 5173 },
});
