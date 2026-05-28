import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static-site build: output goes to dist/, consumable by any static host
// (Render, Netlify, Cloudflare Pages, GitHub Pages, plain nginx).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    // ES2022 unlocks top-level await, which the @sigvault/sdk needs for
    // its runtime-detected `await import('node:zlib')` graceful fallback.
    // All evergreen browsers (Chrome 89+, Firefox 89+, Safari 15+) support it.
    target: 'es2022',
  },
  server: { port: 5173 },
});
