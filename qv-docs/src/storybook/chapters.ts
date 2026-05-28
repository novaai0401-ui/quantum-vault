// SPDX-License-Identifier: Apache-2.0
//
// Vite import.meta.glob bundles the markdown source of every chapter
// into the site at build time. No runtime fetch, no GitHub roundtrip —
// the storybook is fully self-contained.

const RAW: Record<string, string> = import.meta.glob(
  '../../../docs/story/*.md',
  { eager: true, query: '?raw', import: 'default' },
) as Record<string, string>;

export interface Chapter {
  slug:    string;   // URL slug, e.g. "the-problem"
  num:     number;   // 1..22, or 0 for the README index
  title:   string;   // pulled from the first H1
  source:  string;   // raw markdown body
  prev?:   string;   // slug of previous chapter
  next?:   string;   // slug of next chapter
}

function fileSlug(path: string): { num: number; slug: string } {
  const name = path.split('/').pop()!.replace(/\.md$/, '');
  if (name === 'README') return { num: 0, slug: 'index' };
  const m = name.match(/^(\d+)-(.*)$/);
  if (!m) return { num: 999, slug: name };
  return { num: Number(m[1]), slug: m[2] };
}

function extractTitle(md: string, fallback: string): string {
  const m = md.match(/^#\s+(.+?)\s*$/m);
  if (!m) return fallback;
  // Strip a leading "Chapter NN — " or "Chapter NN: " prefix for display
  // so the page heading reads cleaner. The original chapter number is
  // preserved separately via Chapter.num.
  return m[1]
    .replace(/^Chapter\s+\d+\s*[—:-]\s*/i, '')
    .replace(/^The\s+Sigvault\s+Storybook$/i, 'Storybook');
}

const SORTED = Object.entries(RAW)
  .map(([path, source]) => {
    const { num, slug } = fileSlug(path);
    return {
      num,
      slug,
      source: source as string,
      title: extractTitle(source as string, `Chapter ${num}`),
    } as Chapter;
  })
  .sort((a, b) => a.num - b.num);

// Wire up prev/next pointers (skip the README index from the chain).
const NARRATIVE = SORTED.filter((c) => c.num > 0);
for (let i = 0; i < NARRATIVE.length; i++) {
  if (i > 0)                          NARRATIVE[i].prev = NARRATIVE[i - 1].slug;
  if (i < NARRATIVE.length - 1)       NARRATIVE[i].next = NARRATIVE[i + 1].slug;
}

export const chapters: Chapter[] = NARRATIVE;
export const indexChapter: Chapter | undefined = SORTED.find((c) => c.num === 0);

export function chapterBySlug(slug: string): Chapter | undefined {
  return SORTED.find((c) => c.slug === slug);
}

/** Coarse-grained groupings used by the TOC sidebar. */
export const PARTS: { title: string; range: [number, number] }[] = [
  { title: 'I · The world we were born into',     range: [1, 3]   },
  { title: 'II · The cryptographic engine',       range: [4, 7]   },
  { title: 'III · The server',                    range: [8, 12]  },
  { title: 'IV · The periphery',                  range: [13, 15] },
  { title: "V · The practitioner's handbook",     range: [16, 22] },
];
