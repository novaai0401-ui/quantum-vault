// SPDX-License-Identifier: Apache-2.0
//
// Post-build step for the static site. Runs after `vite build` and turns
// the single-page bundle into something crawlers, link previews and AI
// assistants can read without executing JavaScript:
//
//   dist/<route>/index.html   per-route HTML with the right <title>,
//                             description, canonical, Open Graph and
//                             JSON-LD already in the head
//   dist/sitemap.xml          every indexable route, including chapters
//   dist/robots.txt           open to all crawlers, points at the sitemap
//   dist/llms.txt             llms.txt convention: a short, link-rich
//                             summary for AI assistants
//   dist/llms-full.txt        the full storybook as plain Markdown
//
// Zero dependencies. Node 18+.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here    = dirname(fileURLToPath(import.meta.url));
const root    = join(here, '..');
const dist    = join(root, 'dist');
const storyDir = join(root, '..', 'docs', 'story');

const routesJson = JSON.parse(readFileSync(join(root, 'src', 'lib', 'routes.json'), 'utf8'));
const sdkPkg     = JSON.parse(readFileSync(join(root, '..', 'qv-sdk', 'package.json'), 'utf8'));

const SITE_URL = (process.env.VITE_SITE_URL || routesJson.defaultSiteUrl).replace(/\/+$/, '');
const SITE     = routesJson.siteName;
const VERSION  = sdkPkg.version;
const REPO     = 'https://github.com/novaai0401-ui/quantum-vault';
const TODAY    = new Date().toISOString().slice(0, 10);

if (!process.env.VITE_SITE_URL) {
  console.warn(`[postbuild] VITE_SITE_URL not set; canonical URLs default to ${SITE_URL}`);
}
if (!existsSync(join(dist, 'index.html'))) {
  console.error('[postbuild] dist/index.html missing — run `vite build` first');
  process.exit(1);
}

// ── Storybook chapters (same slug/title rules as src/storybook/chapters.ts) ──
function chapterList() {
  if (!existsSync(storyDir)) return [];
  return readdirSync(storyDir)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => {
      const m = f.replace(/\.md$/, '').match(/^(\d+)-(.*)$/);
      if (!m) return null;
      const source = readFileSync(join(storyDir, f), 'utf8');
      const h1 = source.match(/^#\s+(.+?)\s*$/m);
      const title = (h1 ? h1[1] : `Chapter ${m[1]}`).replace(/^Chapter\s+\d+\s*[—:-]\s*/i, '');
      // First paragraph after the heading, as the description.
      const para = source
        .replace(/^#.*$/m, '')
        .split(/\n\s*\n/)
        .map((p) => p.replace(/\s+/g, ' ').trim())
        .find((p) => p && !p.startsWith('#') && !p.startsWith('```') && !p.startsWith('|'));
      return {
        num: Number(m[1]),
        slug: m[2],
        title,
        source,
        description: (para || title).replace(/[*_`>]/g, '').slice(0, 155),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.num - b.num);
}
const chapters = chapterList();

// ── Route table: static routes + one entry per chapter ────────────────────
const routes = [
  ...routesJson.routes,
  ...chapters.map((c) => ({
    path: `/storybook/${c.slug}`,
    priority: 0.6,
    title: `${c.title} — Sigvault storybook, chapter ${c.num}`,
    description: c.description,
    article: true,
  })),
];

// ── HTML helpers ──────────────────────────────────────────────────────────
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function jsonLdFor(route) {
  const url = SITE_URL + (route.path === '/' ? '/' : route.path);
  const graph = [
    {
      '@type': 'WebSite',
      '@id': SITE_URL + '/#website',
      name: SITE,
      url: SITE_URL + '/',
      description: routesJson.defaultDescription,
      inLanguage: 'en',
      publisher: { '@id': SITE_URL + '/#org' },
    },
    {
      '@type': 'Organization',
      '@id': SITE_URL + '/#org',
      name: 'Sigvault contributors',
      url: SITE_URL + '/',
      sameAs: [REPO, 'https://www.npmjs.com/package/@sigvault/sdk', 'https://crates.io/crates/qv-core'],
    },
    {
      '@type': 'SoftwareApplication',
      '@id': SITE_URL + '/#software',
      name: SITE,
      applicationCategory: 'SecurityApplication',
      applicationSubCategory: 'Post-quantum token issuer and verifier',
      operatingSystem: 'Linux, macOS, Windows, Docker, Kubernetes',
      softwareVersion: VERSION,
      license: 'https://www.gnu.org/licenses/agpl-3.0.html',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      downloadUrl: 'https://www.npmjs.com/package/@sigvault/sdk',
      codeRepository: REPO,
      programmingLanguage: ['JavaScript', 'TypeScript', 'Rust', 'Python', 'Go', 'C', 'WebAssembly'],
      featureList: [
        'ML-DSA-87 (FIPS 204) signatures',
        'Falcon-512 and Falcon-1024 signatures',
        'XChaCha20-Poly1305 encrypted claims',
        'Structural replay protection via per-key mutation chain',
        'Zero npm runtime dependencies in the server',
        'Stateless verification in 10 languages',
        'Cosign-signed releases with CycloneDX SBOM',
      ],
      url: SITE_URL + '/',
    },
    {
      '@type': route.article ? 'TechArticle' : 'WebPage',
      '@id': url + '#page',
      url,
      name: route.title,
      headline: route.title,
      description: route.description,
      inLanguage: 'en',
      isPartOf: { '@id': SITE_URL + '/#website' },
      about: { '@id': SITE_URL + '/#software' },
      dateModified: TODAY,
      ...(route.article ? { license: 'https://creativecommons.org/licenses/by/4.0/' } : {}),
    },
  ];
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });
}

function headFor(route) {
  const url = SITE_URL + (route.path === '/' ? '/' : route.path);
  return [
    `<title>${esc(route.title)}</title>`,
    `<meta name="description" content="${esc(route.description)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta name="robots" content="index,follow,max-image-preview:large" />`,
    `<meta property="og:type" content="${route.article ? 'article' : 'website'}" />`,
    `<meta property="og:site_name" content="${esc(SITE)}" />`,
    `<meta property="og:title" content="${esc(route.title)}" />`,
    `<meta property="og:description" content="${esc(route.description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${SITE_URL}/og.png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(route.title)}" />`,
    `<meta name="twitter:description" content="${esc(route.description)}" />`,
    `<meta name="twitter:image" content="${SITE_URL}/og.png" />`,
    `<script type="application/ld+json" id="qv-jsonld-static">${jsonLdFor(route)}</script>`,
  ].join('\n    ');
}

// A crawler that does not run JavaScript still gets the page's substance.
function noscriptFor(route) {
  const links = routesJson.routes
    .map((r) => `<li><a href="${esc(r.path)}">${esc(r.title)}</a></li>`)
    .join('');
  return `<noscript><article>
      <h1>${esc(route.title)}</h1>
      <p>${esc(route.description)}</p>
      <p>${esc(routesJson.defaultDescription)}</p>
      <nav aria-label="Site"><ul>${links}</ul></nav>
      <p>Source: <a href="${REPO}">${REPO}</a>. Plain-text overview: <a href="/llms.txt">/llms.txt</a>.</p>
    </article></noscript>`;
}

// ── Prerender ─────────────────────────────────────────────────────────────
const template = readFileSync(join(dist, 'index.html'), 'utf8');
const HEAD_MARK = /<!-- qv:head:start -->[\s\S]*?<!-- qv:head:end -->/;
if (!HEAD_MARK.test(template)) {
  console.error('[postbuild] index.html is missing the <!-- qv:head:start --> … <!-- qv:head:end --> markers');
  process.exit(1);
}

let written = 0;
for (const route of routes) {
  const html = template
    .replace(HEAD_MARK, `<!-- qv:head:start -->\n    ${headFor(route)}\n    <!-- qv:head:end -->`)
    .replace('<div id="root"></div>', `<div id="root"></div>\n    ${noscriptFor(route)}`);
  const out = route.path === '/' ? join(dist, 'index.html') : join(dist, route.path.slice(1), 'index.html');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  written++;
}

// 404 page (Render/Netlify/Cloudflare Pages all honour dist/404.html).
{
  const route = { path: '/404', title: 'Page not found — Sigvault', description: 'That page does not exist.' };
  const html = template
    .replace(HEAD_MARK, `<!-- qv:head:start -->\n    ${headFor(route).replace('index,follow,max-image-preview:large', 'noindex,follow')}\n    <!-- qv:head:end -->`);
  writeFileSync(join(dist, '404.html'), html);
}

// ── sitemap.xml ───────────────────────────────────────────────────────────
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes.map((r) => `  <url>
    <loc>${esc(SITE_URL + (r.path === '/' ? '/' : r.path))}</loc>
    <lastmod>${TODAY}</lastmod>
    <priority>${r.priority.toFixed(1)}</priority>
  </url>`).join('\n')}
</urlset>
`;
writeFileSync(join(dist, 'sitemap.xml'), sitemap);

// ── robots.txt ────────────────────────────────────────────────────────────
writeFileSync(join(dist, 'robots.txt'), `# ${SITE} — ${SITE_URL}
# All crawlers welcome, including AI assistants. Machine-readable
# overview at /llms.txt, full text at /llms-full.txt.
User-agent: *
Allow: /
Disallow: /404.html

Sitemap: ${SITE_URL}/sitemap.xml
`);

// ── llms.txt (https://llmstxt.org) ───────────────────────────────────────
const llms = `# ${SITE}

> ${routesJson.defaultDescription}

Sigvault (v${VERSION}) is open source: server AGPL-3.0-only, SDKs Apache-2.0,
specification CC BY 4.0. It is self-hosted; there is no SaaS. Signature
suites: ML-DSA-87 (FIPS 204, default), Falcon-512 and Falcon-1024 (FIPS 206
track). Claims are encrypted with XChaCha20-Poly1305. Replay is prevented by
a per-key mutation chain, not by a replay cache. The REST server runs on the
Node.js standard library with zero npm runtime dependencies; this is enforced
by CI. Verification is stateless and available in JavaScript/TypeScript,
WebAssembly, Python, Rust, Go, C, Java, PHP, C# and Ruby.

Install: \`npm install @sigvault/sdk\` · \`pip install sigvault\` ·
\`cargo add qv-core\` · \`docker pull ghcr.io/novaai0401-ui/qv-server:${VERSION}\`

## Start here

${routesJson.routes.filter((r) => ['/', '/quickstart', '/demo', '/ai-threats', '/migration'].includes(r.path))
  .map((r) => `- [${r.title}](${SITE_URL}${r.path === '/' ? '/' : r.path}): ${r.description}`).join('\n')}

## Reference

${routesJson.routes.filter((r) => ['/concepts', '/architecture', '/storybook'].includes(r.path))
  .map((r) => `- [${r.title}](${SITE_URL}${r.path}): ${r.description}`).join('\n')}
- [Specification (OpenAPI + wire format)](${REPO}/tree/main/qv-spec): normative wire format and REST API.
- [Source repository](${REPO}): server, SDKs, FFI, WASM, Helm chart.
- [Security policy](${REPO}/blob/main/SECURITY.md): how to report vulnerabilities.

## Storybook chapters

${chapters.map((c) => `- [${c.num}. ${c.title}](${SITE_URL}/storybook/${c.slug}): ${c.description}`).join('\n')}

## Optional

- [Full text of the storybook](${SITE_URL}/llms-full.txt)
- [About and contact](${SITE_URL}/about)
- [Privacy](${SITE_URL}/privacy) · [Terms](${SITE_URL}/terms)
`;
writeFileSync(join(dist, 'llms.txt'), llms);

const full = `# ${SITE} — full text\n\n${routesJson.defaultDescription}\n\nCanonical site: ${SITE_URL}/ · Source: ${REPO} · Version ${VERSION}\n\n` +
  chapters.map((c) => `\n\n---\n\n<!-- ${SITE_URL}/storybook/${c.slug} -->\n\n${c.source.trim()}`).join('');
writeFileSync(join(dist, 'llms-full.txt'), full);

console.log(`[postbuild] prerendered ${written} routes (${chapters.length} chapters), sitemap.xml, robots.txt, llms.txt, llms-full.txt, 404.html → ${SITE_URL}`);
