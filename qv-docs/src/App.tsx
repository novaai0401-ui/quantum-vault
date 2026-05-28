// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react';
import { Routes, Route, NavLink, Link, useLocation } from 'react-router-dom';

import Landing      from './pages/Landing';
import Quickstart   from './pages/Quickstart';
import Concepts     from './pages/Concepts';
import Architecture from './pages/Architecture';
import Storybook    from './pages/Storybook';
import Chapter      from './pages/Chapter';
import Demo         from './pages/Demo';

const REPO = 'https://github.com/novaai0401-ui/quantum-vault';

function Nav() {
  const [open, setOpen] = useState(false);
  const cls = ({ isActive }: { isActive: boolean }) =>
    'qv-link' + (isActive ? ' active' : '');
  const close = () => setOpen(false);

  return (
    <header className="qv-nav">
      <div className="qv-nav-inner">
        <Link to="/" className="qv-brand" onClick={close}>
          Sigvault<span className="dot">.</span>
        </Link>

        <button
          className={'qv-nav-burger' + (open ? ' open' : '')}
          aria-label="Toggle navigation"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span /><span /><span />
        </button>

        <nav className={'qv-nav-links' + (open ? ' open' : '')}>
          <NavLink to="/quickstart"   className={cls} onClick={close}>Quickstart</NavLink>
          <NavLink to="/demo"         className={cls} onClick={close}>Live demo</NavLink>
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
            <li><a href="https://hub.docker.com/r/novaai0401-ui/qv-server" target="_blank" rel="noreferrer">ghcr.io image</a></li>
          </ul>
        </div>
        <div>
          <h4>Learn</h4>
          <ul>
            <li><Link to="/storybook">Storybook (22 chapters)</Link></li>
            <li><Link to="/concepts">How it works</Link></li>
            <li><Link to="/architecture">Architecture</Link></li>
            <li><a href={`${REPO}/tree/main/qv-spec`} target="_blank" rel="noreferrer">Spec (OpenAPI + wire format)</a></li>
          </ul>
        </div>
        <div>
          <h4>Source &amp; legal</h4>
          <ul>
            <li><a href={REPO} target="_blank" rel="noreferrer">GitHub</a></li>
            <li><a href={`${REPO}/blob/main/LICENSING.md`} target="_blank" rel="noreferrer">Licence map</a></li>
            <li><a href={`${REPO}/blob/main/SECURITY.md`} target="_blank" rel="noreferrer">Security policy</a></li>
            <li><a href={`${REPO}/blob/main/CODE_OF_CONDUCT.md`} target="_blank" rel="noreferrer">Code of conduct</a></li>
          </ul>
        </div>
        <div className="legal">
          Server: AGPL-3.0-only · SDKs: Apache-2.0 · Spec: CC BY 4.0
          &nbsp;·&nbsp; v4.3.7 &nbsp;·&nbsp;
          Sigvault is built and maintained by independent contributors.
        </div>
      </div>
    </footer>
  );
}

function ScrollReset() {
  const { pathname } = useLocation();
  // Scroll on every route push so /storybook → /storybook/foo starts at top.
  // useLayoutEffect would jump-cut; useEffect is fine for a content site.
  if (typeof window !== 'undefined') {
    queueMicrotask(() => window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }));
  }
  return null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void pathname;
}

export default function App() {
  return (
    <div className="qv-shell">
      <ScrollReset />
      <Nav />
      <main className="qv-main">
        <Routes>
          <Route path="/"                  element={<Landing />} />
          <Route path="/quickstart"        element={<Quickstart />} />
          <Route path="/demo"              element={<Demo />} />
          <Route path="/storybook"         element={<Storybook />} />
          <Route path="/storybook/:slug"   element={<Chapter />} />
          <Route path="/concepts"          element={<Concepts />} />
          <Route path="/architecture"      element={<Architecture />} />
          <Route path="*"                  element={<Landing />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
