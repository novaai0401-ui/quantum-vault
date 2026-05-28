// SPDX-License-Identifier: Apache-2.0
//
// Markdown renderer + helpers. Uses `marked` for parse + a tiny custom
// renderer to make the output match our hand-written CSS (no @tailwind,
// no GitHub-style classes — clean semantic HTML the site styles itself).

import { marked, Renderer } from 'marked';

// Custom renderer — keep semantic output, no inline styles. The site
// CSS handles all the visuals via .prose-block descendants.
const renderer = new Renderer();

renderer.heading = ({ text, depth }) => {
  // marked passes tokens for inline; the default renderer already produces
  // inner HTML. We just add slugified IDs so chapter sections are
  // linkable from the TOC sidebar.
  const slug = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60);
  return `<h${depth} id="${slug}"><a href="#${slug}" class="anchor" aria-hidden="true">#</a> ${text}</h${depth}>\n`;
};

renderer.code = ({ text, lang }) => {
  const language = (lang ?? '').replace(/[^a-zA-Z0-9_+-]/g, '');
  return `<pre data-lang="${language}"><code>${escapeHtml(text)}</code></pre>\n`;
};

renderer.link = ({ href, title, text }) => {
  // Internal cross-chapter links (./03-threat-model.md → /storybook/threat-model)
  let target = href ?? '';
  const m = target.match(/^\.\/(\d+)-(.+)\.md(#.*)?$/);
  if (m) {
    const [, , slug, hash] = m;
    target = `/storybook/${slug}${hash ?? ''}`;
  } else if (/^https?:\/\//.test(target)) {
    // External link — open in new tab.
    return `<a href="${target}" target="_blank" rel="noreferrer"${title ? ` title="${title}"` : ''}>${text}</a>`;
  }
  return `<a href="${target}"${title ? ` title="${title}"` : ''}>${text}</a>`;
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

marked.use({ renderer, gfm: true, breaks: false });

/** Render a markdown string to safe HTML for dangerouslySetInnerHTML. */
export function renderMarkdown(src: string): string {
  // Drop the first H1 — the page lays it out separately as the title.
  const stripped = src.replace(/^#\s+.+?\n/, '');
  return marked.parse(stripped) as string;
}

/** Extract every H2 from the source for the in-chapter TOC. */
export function extractH2(src: string): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  for (const m of src.matchAll(/^##\s+(.+)$/gm)) {
    const text = m[1].trim();
    const id = text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 60);
    out.push({ id, text });
  }
  return out;
}
