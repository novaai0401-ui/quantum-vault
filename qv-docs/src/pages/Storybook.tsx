// SPDX-License-Identifier: Apache-2.0
import { Link } from 'react-router-dom';
import { TkxButton, TkxCard, TkxCardBody, TkxBadge } from 'tekivex-ui';
import { chapters, PARTS } from '../storybook/chapters';

export default function Storybook() {
  return (
    <div className="page">
      <div className="container">
        <div className="section-eyebrow">Storybook</div>
        <h1>The reasoning behind every line of code.</h1>
        <p className="section-lead">
          Twenty-two chapters that explain what Sigvault is, why it exists,
          how each layer works, and what we deliberately chose to leave out.
          Read in order for the full picture, or jump to the chapter that
          matches what you're solving.
        </p>

        <div className="storybook-parts">
          {PARTS.map((part) => {
            const inPart = chapters.filter(
              (c) => c.num >= part.range[0] && c.num <= part.range[1],
            );
            return (
              <TkxCard
                key={part.title}
                variant="outlined" padding="lg"
                className="storybook-part-card"
              >
                <TkxCardBody>
                  <TkxBadge variant="subtle" colorScheme="primary" size="sm">
                    Part {part.title}
                  </TkxBadge>
                  <ol className="chapter-list">
                    {inPart.map((c) => (
                      <li key={c.slug}>
                        <Link to={`/storybook/${c.slug}`}>
                          <span className="num">{String(c.num).padStart(2, '0')}</span>
                          <span className="title">{c.title}</span>
                        </Link>
                      </li>
                    ))}
                  </ol>
                </TkxCardBody>
              </TkxCard>
            );
          })}
        </div>

        <div className="storybook-cta">
          <Link to="/storybook/the-problem">
            <TkxButton variant="solid" colorScheme="primary" size="lg">
              Start at chapter 1 →
            </TkxButton>
          </Link>
          <Link to="/demo">
            <TkxButton variant="outline" colorScheme="neutral" size="lg">
              Skip to the interactive demo
            </TkxButton>
          </Link>
        </div>
      </div>
    </div>
  );
}
