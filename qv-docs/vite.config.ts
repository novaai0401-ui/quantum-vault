import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The site advertises the SDK version everywhere (footer, install tabs,
// JSON-LD). Read it once from the SDK manifest so a release bump never
// leaves the website quoting a stale number.
const sdkPkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../qv-sdk/package.json', import.meta.url)), 'utf8'),
) as { version: string };

// Static-site build: output goes to dist/, consumable by any static host
// (Render, Netlify, Cloudflare Pages, GitHub Pages, plain nginx).
// `scripts/postbuild.mjs` then prerenders per-route HTML, sitemap.xml,
// robots.txt and llms.txt into dist/.
export default defineConfig({
  plugins: [react()],
  define: {
    __QV_VERSION__: JSON.stringify(sdkPkg.version),
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // ES2022 unlocks top-level await, which the @sigvault/sdk needs for
    // its runtime-detected `await import('node:zlib')` graceful fallback.
    // All evergreen browsers (Chrome 89+, Firefox 89+, Safari 15+) support it.
    target: 'es2022',
  },
  // The dev-mode esbuild dep-optimizer uses its OWN target (separate from
  // build.target). Without this, the SDK's top-level await fails to bundle
  // for the dev server even though the production build works.
  optimizeDeps: {
    esbuildOptions: { target: 'es2022' },
  },
  server: { port: 5173 },
});
