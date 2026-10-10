// SPDX-License-Identifier: Apache-2.0
import { Suspense, lazy, useEffect, useState } from 'react';
import { Routes, Route, NavLink, Link, useLocation } from 'react-router-dom';

import Landing      from './pages/Landing';
import Quickstart   from './pages/Quickstart';
import Concepts     from './pages/Concepts';
import Architecture from './pages/Architecture';
// Heavy routes load on demand: the demo pulls in the post-quantum SDK,
// the storybook pulls in the Markdown renderer and 22 chapters.
const Storybook = lazy(() => import('./pages/Storybook'));
const Chapter   = lazy(() => import('./pages/Chapter'));
const Demo      = lazy(() => import('./pages/Demo'));
import Migration    from './pages/Migration';
import AiThreats    from './pages/AiThreats';
import { About, Privacy, Terms, NotFound } from './pages/Legal';
import { REPO, VERSION } from './lib/site';

function Nav() {
  const [open, setOpen] = useState(false);
  const cls = ({ isActive }: { isActive: boolean }) =>
    'qv-link' + (isActive ? ' active' : '');
  const close = () => setOpen(false);

  return (
    <header className="qv-nav">
      <div className="qv-nav-inner">
        <Link to="/" className="qv-brand" onClick={close} aria-label="Sigvault home">
          Sigvault<span className="dot">.</span>
        </Link>

        <button
          className={'qv-nav-burger' + (open ? ' open' : '')}
          aria-label="Toggle navigation"
          aria-expanded={open}
          aria-controls="qv-primary-nav"
          onClick={() => setOpen((o) => !o)}
        >
          <span /><span /><span />
        </button>

        <nav id="qv-primary-nav" aria-label="Primary" className={'qv-nav-links' + (open ? ' open' : '')}>
          <NavLink to="/quickstart"   className={cls} onClick={close}>Quickstart</NavLink>
          <NavLink to="/demo"         className={cls} onClick={close}>Live demo</NavLink>
          <NavLink to="/ai-threats"   className={cls} onClick={close}>AI threats</NavLink>
          <NavLink to="/migration"    className={cls} onClick={close}>Timeline</NavLink>
          <NavLink to="/storybook"    className={cls} onClick={close}>Storybook</NavLink>
          <NavLink to="/concepts"     className={cls} onClick={close}>How it works</NavLink>
          <NavLink to="/architecture" className={cls} onClick={close}>Architecture</NavLink>
          <a
            className="qv-nav-cta qv-link"
            href={REPO}
            target="_blank"
            rel="noreferrer"
            onClick={close}
          >GitHub →</a>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="qv-footer">
      <div className="qv-footer-inner">
        <div>
          <Link to="/" className="qv-brand">Sigvault<span className="dot">.</span></Link>
          <p style={{ marginTop: 12, maxWidth: 360 }}>
            Quantum-safe, sovereign token issuer and verifier. Built on
            Node and Rust standard libraries — nothing else.
          </p>
        </div>
        <div>
          <h4>Try it</h4>
          <ul>
            <li><Link to="/quickstart">Quickstart</Link></li>
            <li><Link to="/demo">Interactive demo</Link></li>
            <li><a href="https://www.npmjs.com/package/@sigvault/sdk" target="_blank" rel="noreferrer">@sigvault/sdk on npm</a></li>
            <li><a href="https://crates.io/crates/qv-core" target="_blank" rel="noreferrer">qv-core on crates.io</a></li>
            <li><a href="https://github.com/novaai0401-ui/quantum-vault/pkgs/container/qv-server" target="_blank" rel="noreferrer">ghcr.io image</a></li>
          </ul>
        </div>
        <div>
          <h4>Learn</h4>
          <ul>
            <li><Link to="/ai-threats">AI-era threat model</Link></li>
            <li><Link to="/migration">Migration timeline</Link></li>
            <li><Link to="/storybook">Storybook (22 chapters)</Link></li>
            <li><Link to="/concepts">How it works</Link></li>
            <li><Link to="/architecture">Architecture</Link></li>
            <li><a href={`${REPO}/tree/main/qv-spec`} target="_blank" rel="noreferrer">Spec (OpenAPI + wire format)</a></li>
            <li><a href="/llms.txt">llms.txt for AI assistants</a></li>
          </ul>
        </div>
        <div>
          <h4>Project</h4>
          <ul>
            <li><Link to="/about">About &amp; contact</Link></li>
            <li><a href={REPO} target="_blank" rel="noreferrer">GitHub</a></li>
            <li><a href={`${REPO}/blob/main/SECURITY.md`} target="_blank" rel="noreferrer">Security policy</a></li>
            <li><a href={`${REPO}/blob/main/LICENSING.md`} target="_blank" rel="noreferrer">Licence map</a></li>
            <li><Link to="/privacy">Privacy</Link></li>
            <li><Link to="/terms">Terms</Link></li>
          </ul>
        </div>
        <div className="legal">
          Server: AGPL-3.0-only · SDKs: Apache-2.0 · Spec: CC BY 4.0
          &nbsp;·&nbsp; v{VERSION} &nbsp;·&nbsp;
          Sigvault is built and maintained by independent contributors.
        </div>
      </div>
    </footer>
  );
}

function ScrollReset() {
  const { pathname } = useLocation();
  useEffect(() => {
    // Hash links (#section) are handled by the browser; everything else
    // starts at the top so /storybook → /storybook/foo begins at the title.
    if (!window.location.hash) {
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    }
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <div className="qv-shell">
      <a href="#main" className="qv-skip">Skip to content</a>
      <ScrollReset />
      <Nav />
      <main id="main" className="qv-main" tabIndex={-1}>
        <Suspense fallback={<div className="page"><div className="container-narrow" aria-busy="true">Loading…</div></div>}>
        <Routes>
          <Route path="/"                  element={<Landing />} />
          <Route path="/quickstart"        element={<Quickstart />} />
          <Route path="/demo"              element={<Demo />} />
          <Route path="/migration"         element={<Migration />} />
          <Route path="/ai-threats"        element={<AiThreats />} />
          <Route path="/storybook"         element={<Storybook />} />
          <Route path="/storybook/:slug"   element={<Chapter />} />
          <Route path="/concepts"          element={<Concepts />} />
          <Route path="/architecture"      element={<Architecture />} />
          <Route path="/about"             element={<About />} />
          <Route path="/privacy"           element={<Privacy />} />
          <Route path="/terms"             element={<Terms />} />
          <Route path="*"                  element={<NotFound />} />
        </Routes>
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
