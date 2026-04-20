import { Routes, Route, NavLink, Link } from 'react-router-dom';
import Landing      from './pages/Landing';
import Quickstart   from './pages/Quickstart';
import Languages    from './pages/Languages';
import ApiRef       from './pages/ApiRef';
import Architecture from './pages/Architecture';
import Demo         from './pages/Demo';

function Nav() {
  const link = ({ isActive }: { isActive: boolean }) =>
    'qv-link' + (isActive ? ' active' : '');
  return (
    <header className="qv-nav">
      <div className="qv-nav-inner">
        <Link to="/" className="qv-brand">
          QuantumVault<span className="dot">.</span>
        </Link>
        <NavLink to="/quickstart"   className={link}>Quickstart</NavLink>
        <NavLink to="/languages"    className={link}>Languages</NavLink>
        <NavLink to="/api"          className={link}>REST&nbsp;API</NavLink>
        <NavLink to="/architecture" className={link}>Architecture</NavLink>
        <NavLink to="/demo"         className={link}>Live&nbsp;demo</NavLink>
        <span className="spacer" />
        <a
          href="https://github.com/007krcs/quantum-vault"
          target="_blank"
          rel="noreferrer"
          className="qv-link"
        >
          GitHub →
        </a>
      </div>
    </header>
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
          <Route path="/languages"    element={<Languages />} />
          <Route path="/api"          element={<ApiRef />} />
          <Route path="/architecture" element={<Architecture />} />
          <Route path="/demo"         element={<Demo />} />
          <Route path="*" element={<Landing />} />
        </Routes>
      </main>
      <footer className="qv-footer">
        Apache-2.0 · v4.1-γ · Built with Rust + Node stdlib ·{' '}
        <a href="https://github.com/007krcs/quantum-vault">source</a>
      </footer>
    </div>
  );
}
