// SPDX-License-Identifier: Apache-2.0
import { Routes, Route, NavLink, Link } from 'react-router-dom';

import Landing      from './pages/Landing';
import Quickstart   from './pages/Quickstart';
import Concepts     from './pages/Concepts';
import Architecture from './pages/Architecture';

function Nav() {
  const cls = ({ isActive }: { isActive: boolean }) =>
    'qv-link' + (isActive ? ' active' : '');
  return (
    <header className="qv-nav">
      <div className="qv-nav-inner">
        <Link to="/" className="qv-brand">
          Sigvault<span className="dot">.</span>
        </Link>
        <nav>
          <NavLink to="/quickstart"   className={cls}>Quickstart</NavLink>
          <NavLink to="/concepts"     className={cls}>How it works</NavLink>
          <NavLink to="/architecture" className={cls}>Architecture</NavLink>
        </nav>
        <span className="spacer" />
        <a
          className="qv-nav-cta"
          href="https://github.com/007krcs/quantum-vault"
          target="_blank"
          rel="noreferrer"
        >GitHub →</a>
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
          <h4>Product</h4>
          <ul>
            <li><Link to="/quickstart">Quickstart</Link></li>
            <li><Link to="/concepts">How it works</Link></li>
            <li><Link to="/architecture">Architecture</Link></li>
          </ul>
        </div>
        <div>
          <h4>Build</h4>
          <ul>
            <li><a href="https://github.com/007krcs/quantum-vault" target="_blank" rel="noreferrer">Source</a></li>
            <li><a href="https://github.com/007krcs/quantum-vault/tree/main/qv-spec" target="_blank" rel="noreferrer">Specification</a></li>
            <li><a href="https://github.com/007krcs/quantum-vault/tree/main/docs/story" target="_blank" rel="noreferrer">Storybook</a></li>
          </ul>
        </div>
        <div>
          <h4>Legal</h4>
          <ul>
            <li><a href="https://github.com/007krcs/quantum-vault/blob/main/LICENSING.md" target="_blank" rel="noreferrer">Licence map</a></li>
            <li><a href="https://github.com/007krcs/quantum-vault/blob/main/SECURITY.md" target="_blank" rel="noreferrer">Security policy</a></li>
            <li><a href="https://github.com/007krcs/quantum-vault/blob/main/CODE_OF_CONDUCT.md" target="_blank" rel="noreferrer">Code of conduct</a></li>
          </ul>
        </div>
        <div className="legal">
          Server: AGPL-3.0-only · SDKs: Apache-2.0 · Spec: CC BY 4.0
          &nbsp;·&nbsp; v4.3.0 &nbsp;·&nbsp;
          Sigvault is built and maintained by independent contributors.
        </div>
      </div>
    </footer>
  );
}

export default function App() {
  return (
    <div className="qv-shell">
      <Nav />
      <main className="qv-main">
        <Routes>
          <Route path="/"             element={<Landing />} />
          <Route path="/quickstart"   element={<Quickstart />} />
          <Route path="/concepts"     element={<Concepts />} />
          <Route path="/architecture" element={<Architecture />} />
          <Route path="*"             element={<Landing />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
