// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { TkxBadge } from 'tekivex-ui';

import { chapterBySlug, chapters } from '../storybook/chapters';
import { renderMarkdown, extractH2 } from '../storybook/md';

export default function Chapter() {
  const { slug } = useParams<{ slug: string }>();
  const chapter = useMemo(() => (slug ? chapterBySlug(slug) : undefined), [slug]);

  // Scroll to top on chapter change so a reader who clicks "Next" starts
  // at the title, not mid-page.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [slug]);

  if (!chapter) {
    return (
      <div className="page">
        <div className="container-narrow">
          <h1>Chapter not found</h1>
          <p className="section-lead">
            No chapter at <code>/{slug}</code>. <Link to="/storybook">Back to the index</Link>.
          </p>
        </div>
      </div>
    );
  }

  const html = useMemo(() => renderMarkdown(chapter.source), [chapter.source]);
  const toc  = useMemo(() => extractH2(chapter.source), [chapter.source]);

  return (
    <div className="page chapter-page">
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
