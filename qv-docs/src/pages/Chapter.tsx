// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { TkxBadge } from 'tekivex-ui';

import { chapterBySlug, chapters } from '../storybook/chapters';
import { renderMarkdown, extractH2 } from '../storybook/md';
import { Seo, breadcrumbs, techArticle } from '../lib/seo';

/** First prose paragraph of a chapter, for the meta description. */
function firstParagraph(md: string): string {
  const para = md
    .replace(/^#.*$/m, '')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .find((p) => p && !/^[#`|>]/.test(p));
  return (para ?? '').replace(/[*_`]/g, '').slice(0, 155);
}

export default function Chapter() {
  const { slug } = useParams<{ slug: string }>();
  const chapter = useMemo(() => (slug ? chapterBySlug(slug) : undefined), [slug]);

  // Scroll to top on chapter change so a reader who clicks "Next" starts
  // at the title, not mid-page.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [slug]);

  const html = useMemo(() => (chapter ? renderMarkdown(chapter.source) : ''), [chapter]);
  const toc  = useMemo(() => (chapter ? extractH2(chapter.source) : []), [chapter]);

  if (!chapter) {
    return (
      <div className="page">
        <Seo title="Chapter not found — Sigvault" description="No such storybook chapter." noindex />
        <div className="container-narrow">
          <h1>Chapter not found</h1>
          <p className="section-lead">
            No chapter at <code>/{slug}</code>. <Link to="/storybook">Back to the index</Link>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page chapter-page">
      <Seo
        title={`${chapter.title} — Sigvault storybook, chapter ${chapter.num}`}
        description={firstParagraph(chapter.source)}
        jsonLd={[
          breadcrumbs([
            { name: 'Home', path: '/' },
            { name: 'Storybook', path: '/storybook' },
            { name: chapter.title, path: `/storybook/${chapter.slug}` },
          ]),
          techArticle({
            headline: chapter.title,
            description: firstParagraph(chapter.source),
            path: `/storybook/${chapter.slug}`,
          }),
        ]}
      />
      <div className="chapter-layout">
        <aside className="chapter-toc">
          <div className="toc-title">In this chapter</div>
          <ol>
            {toc.map((h) => (
              <li key={h.id}>
                <a href={`#${h.id}`}>{h.text}</a>
              </li>
            ))}
          </ol>
          <div className="toc-meta">
            <Link to="/storybook" className="toc-back">← All chapters</Link>
          </div>
        </aside>

        <article className="chapter-body">
          <TkxBadge variant="subtle" colorScheme="primary" size="sm" style={{ marginBottom: 10 }}>
            Chapter {String(chapter.num).padStart(2, '0')} · Storybook
          </TkxBadge>
          <h1>{chapter.title}</h1>
          <div
            className="prose-block"
            dangerouslySetInnerHTML={{ __html: html }}
          />

          <nav className="chapter-nav">
            {chapter.prev && (
              <Link to={`/storybook/${chapter.prev}`} className="prev">
                <span className="dir">← Previous</span>
                <span className="title">
                  {chapters.find((c) => c.slug === chapter.prev)?.title}
                </span>
              </Link>
            )}
            <span className="spacer" />
            {chapter.next && (
              <Link to={`/storybook/${chapter.next}`} className="next">
                <span className="dir">Next →</span>
                <span className="title">
                  {chapters.find((c) => c.slug === chapter.next)?.title}
                </span>
              </Link>
            )}
          </nav>
        </article>
      </div>
    </div>
  );
}
