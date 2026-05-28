// SPDX-License-Identifier: Apache-2.0
import { Link } from 'react-router-dom';
import { chapters, PARTS } from '../storybook/chapters';

export default function Storybook() {
  return (
    <div className="page">
      <div className="container">
        <div className="section-eyebrow">Storybook</div>
        <h1>
          The reasoning behind every line of code.
        </h1>
        <p className="section-lead">
          Twenty-two chapters that explain what Sigvault is, why it
          exists, how each layer works, and what we deliberately
          chose to leave out. Read in order for the full picture, or
          jump to the chapter that matches what you're solving.
        </p>

        <div className="storybook-parts">
          {PARTS.map((part) => {
            const inPart = chapters.filter(
              (c) => c.num >= part.range[0] && c.num <= part.range[1],
            );
            return (
              <section key={part.title} className="storybook-part">
                <h2>Part {part.title}</h2>
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
              </section>
            );
          })}
        </div>

        <div className="storybook-cta">
          <Link to="/storybook/the-problem" className="btn btn-primary">
            Start at chapter 1 →
          </Link>
          <Link to="/demo" className="btn btn-ghost">
            Skip to the interactive demo
          </Link>
        </div>
      </div>
    </div>
  );
}
