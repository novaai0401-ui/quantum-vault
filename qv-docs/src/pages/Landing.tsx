// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react';
import { Link } from 'react-router-dom';

const INSTALL = {
  npm:    `npm install @sigvault/sdk`,
  python: `pip install sigvault`,
  go:     `import "github.com/007krcs/quantum-vault/qv-sdk/go"`,
  cargo:  `cargo add qv-core`,
  docker: `docker pull ghcr.io/007krcs/qv-server:4.3.0`,
};

export default function Landing() {
  const [tab, setTab] = useState<keyof typeof INSTALL>('npm');

  return (
    <>
      {/* ────────── Hero ────────── */}
      <section className="hero">
        <div className="container">
          <span className="hero-eyebrow">v4.3 · Production · Quantum-safe</span>
          <h1>
            Sovereign tokens, <span className="em">post-quantum</span><br/>
            from the first byte.
          </h1>
          <p className="lead">
            Sigvault is a token issuer and verifier built on ML-DSA-87 and
            Falcon — the NIST post-quantum standards. The server has zero
            npm dependencies. The SDKs use only audited crypto. The spec
            is open. Run it on your own hardware, in your own cluster,
            under your own keys.
          </p>

          <div className="cta-row">
            <Link to="/quickstart" className="btn btn-primary">
              Get started in 60 seconds →
            </Link>
            <a className="btn btn-ghost"
               href="https://github.com/007krcs/quantum-vault"
               target="_blank" rel="noreferrer">
              Read the source on GitHub
            </a>
          </div>

          <div className="hero-stats">
            <div className="hero-stat">
              <div className="num">0</div>
              <div className="lbl">npm dependencies in the server</div>
            </div>
            <div className="hero-stat">
              <div className="num">341</div>
              <div className="lbl">tests, ≈30 s, three operating systems</div>
            </div>
            <div className="hero-stat">
              <div className="num">3</div>
              <div className="lbl">post-quantum suites — ML-DSA-87, Falcon-512/1024</div>
            </div>
            <div className="hero-stat">
              <div className="num">7</div>
              <div className="lbl">first-party SDK languages</div>
            </div>
          </div>
        </div>
      </section>

      {/* ────────── Why post-quantum ────────── */}
      <section className="block">
        <div className="container">
          <div className="section-eyebrow">The problem</div>
          <h2>Tokens issued today must outlive the cryptography they were signed with.</h2>
          <p className="section-lead">
            JWT, PASETO, and every RSA/ECDSA-based token scheme rely on
            assumptions that a sufficiently advanced quantum computer
            breaks. Adversaries are already harvesting traffic for later
            decryption. Tokens that need to be valid in 2030 cannot be
            signed with 2010 cryptography.
          </p>

          <div className="grid-3" style={{ marginTop: 36 }}>
            <Card icon="◇" title="Harvest now, decrypt later">
              An adversary capturing your tokens today can break their
              signatures retroactively the moment a cryptographically-relevant
              quantum computer exists. Sigvault closes that window structurally.
            </Card>
            <Card icon="◈" title="NIST-standard primitives only">
              ML-DSA-87 is FIPS 204. Falcon is on the FIPS 206 path.
              No experimental schemes, no homegrown crypto, no
              backdoors-with-good-intentions. Audited reference
              implementations only.
            </Card>
            <Card icon="◆" title="Replay-proof by construction">
              Every token carries a per-key MutationChain counter that is
              cryptographically linked to its predecessors. A replayed
              token is structurally rejected — no replay cache, no
              clock-skew window, no "did we remember to flush the bloom
              filter."
            </Card>
          </div>
        </div>
      </section>

      {/* ────────── What you get ────────── */}
      <section className="block">
        <div className="container">
          <div className="section-eyebrow">What ships</div>
          <h2>The whole platform, on standard libraries.</h2>
          <p className="section-lead">
            One server, seven SDKs, one spec, one container, one Helm chart.
            The dependency surface is small enough to read end-to-end in
            an afternoon — and we wrote a CI gate that keeps it that way.
          </p>

          <div className="grid-3" style={{ marginTop: 36 }}>
            <Card icon="✦" title="Zero-dependency server">
              <code>qv-server</code> is Node.js stdlib only. No express, no
              axios, no jsonwebtoken. CI rejects any commit that adds an
              npm runtime dependency. The 2024 XZ-class supply-chain
              attack surface is structurally absent here.
            </Card>
            <Card icon="✦" title="Multi-writer Postgres backend">
              Horizontal scale via a hand-written zero-dep Postgres wire
              client. Two writers racing the same chain counter? The
              database PRIMARY KEY guarantees exactly one wins; the loser
              gets <code>CHAIN_LOG_CONFLICT</code>. No coordinator, no
              advisory lock, no split-brain.
            </Card>
            <Card icon="✦" title="Cryptographic chain log">
              Every chain log entry is the SHA3-256 hash of the previous
              state. Boot replays the chain, verifies linkage, and
              refuses to start if any record was tampered. Replay
              protection is enforced at restart, not just at runtime.
            </Card>
            <Card icon="✦" title="Pluggable secrets manager">
              Master key sourced from a file, an env var, or any operator
              command — AWS KMS, HashiCorp Vault, Azure Key Vault, GCP KMS,
              1Password, sops. No vendor lock-in, no native module to
              link.
            </Card>
            <Card icon="✦" title="Per-tenant fairness">
              Per-IP and per-keyId rate limits compose. A noisy keyId
              cannot drain the shared bucket. <code>/v3/keys/&lbrace;id&rbrace;/quota</code>{' '}
              gives your dashboards a real-time view of every tenant's
              ceiling.
            </Card>
            <Card icon="✦" title="Cosign-signed releases">
              Every published image is signed against a GitHub Actions
              OIDC identity and ships with a CycloneDX 1.5 SBOM as an
              OCI attestation. Operators verify with{' '}
              <code>cosign verify</code> before deploy.
            </Card>
          </div>
        </div>
      </section>

      {/* ────────── Install ────────── */}
      <section className="block">
        <div className="container-narrow">
          <div className="section-eyebrow">Quick install</div>
          <h2>From "I want to try this" to a verified token in a minute.</h2>
          <p className="section-lead">
            Pick your language. The SDKs share a single wire format and a
            single conformance test suite — your client code is portable
            across every backend that speaks Sigvault.
          </p>

          <div className="tabs" role="tablist" aria-label="Install" style={{ marginTop: 28 }}>
            {(Object.keys(INSTALL) as Array<keyof typeof INSTALL>).map(k => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                className={'tab' + (tab === k ? ' active' : '')}
                onClick={() => setTab(k)}
              >
                {k}
              </button>
            ))}
          </div>
          <pre><code>{INSTALL[tab]}</code></pre>

          <div className="cta-row">
            <Link to="/quickstart" className="btn btn-primary">Full quickstart →</Link>
          </div>
        </div>
      </section>

      {/* ────────── How it composes ────────── */}
      <section className="block">
        <div className="container">
          <div className="section-eyebrow">How it composes</div>
          <h2>Frontend issues. Backend verifies. Sigvault is in between.</h2>
          <p className="section-lead">
            Your frontend authenticates against your existing identity provider
            and asks Sigvault for a token. Your backend (in any language) reads
            the token from the <code>Authorization</code> header and either
            verifies it locally with the SDK or asks Sigvault.
          </p>

          <div className="diagram" style={{ marginTop: 32 }}>
            <div className="node">Frontend / Browser</div>
            <div className="arrow">→</div>
            <div className="node">Sigvault Server<br/><span style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>issue · verify</span></div>
            <div className="arrow">→</div>
            <div className="node">Your Backend<br/><span style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>any language</span></div>
          </div>
        </div>
      </section>

      {/* ────────── Comparison ────────── */}
      <section className="block">
        <div className="container">
          <div className="section-eyebrow">Compared</div>
          <h2>Where Sigvault uniquely fits.</h2>
          <p className="section-lead">
            Auth0 wins consumer login. HashiCorp Vault wins general-purpose
            secret storage. Sigvault wins the ground in between: a
            sovereign, post-quantum, replay-proof token issuer that is
            yours to operate.
          </p>

          <table className="compare" style={{ marginTop: 28 }}>
            <thead>
              <tr>
                <th>Capability</th>
                <th>JWT&nbsp;(generic)</th>
                <th>Auth0</th>
                <th>HashiCorp&nbsp;Vault</th>
                <th>Sigvault</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Post-quantum signatures',          'no',  'no',  'no',  'yes'],
                ['Claims AEAD-encrypted',            'no',  'no',  'n/a', 'yes'],
                ['Replay-proof structurally',        'no',  'no',  'n/a', 'yes'],
                ['Zero npm runtime deps',            'n/a', 'n/a', 'n/a', 'yes'],
                ['Sovereign — you own the keys',     'yes', 'no',  'yes', 'yes'],
                ['Stateless verify',                 'yes', 'no',  'no',  'yes'],
                ['Multi-writer horizontal scale',    'n/a', 'n/a', 'yes', 'yes'],
              ].map(([feat, j, a, v, q]) => (
                <tr key={feat}>
                  <td className="feat">{feat}</td>
                  <td><Yes value={j} /></td>
                  <td><Yes value={a} /></td>
                  <td><Yes value={v} /></td>
                  <td><Yes value={q} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ────────── Licence band ────────── */}
      <section className="block licence-band">
        <div className="container-narrow">
          <div className="section-eyebrow">Licence</div>
          <h2>Open enough to audit. Protected enough to last.</h2>
          <p className="section-lead">
            The server is AGPL-3.0 — read every line, run it on your own
            metal, modify what you need. The SDKs are Apache-2.0 —
            embed them in any product. The specification is CC BY 4.0 —
            write your own conforming implementation. The full rationale,
            including why we picked this split over BUSL or Elastic, is
            in <a
              href="https://github.com/007krcs/quantum-vault/blob/main/LICENSING.md"
              target="_blank" rel="noreferrer">LICENSING.md</a>.
          </p>

          <div className="grid-3" style={{ marginTop: 32 }}>
            <Card title="Server" icon="●" tone="muted">
              <span className="chip">AGPL-3.0-only</span>
              <p>Operators run it freely. SaaS providers comply with §13.</p>
            </Card>
            <Card title="SDK" icon="●" tone="muted">
              <span className="chip">Apache-2.0</span>
              <p>Embed in any product, any licence, no friction.</p>
            </Card>
            <Card title="Specification" icon="●" tone="muted">
              <span className="chip">CC BY 4.0</span>
              <p>Write your own conforming server in any language.</p>
            </Card>
          </div>
        </div>
      </section>

      {/* ────────── CTA ────────── */}
      <section className="block">
        <div className="container-narrow" style={{ textAlign: 'center' }}>
          <h2>The next decade of identity is post-quantum.</h2>
          <p className="section-lead" style={{ margin: '0 auto' }}>
            Start with a five-minute quickstart on your laptop. Promote
            it to a real cluster when you're ready.
          </p>
          <div className="cta-row" style={{ justifyContent: 'center', marginTop: 28 }}>
            <Link to="/quickstart" className="btn btn-primary">Open the quickstart</Link>
            <a className="btn btn-ghost"
               href="https://github.com/007krcs/quantum-vault/tree/main/docs/story"
               target="_blank" rel="noreferrer">
              Read the storybook
            </a>
          </div>
        </div>
      </section>
    </>
  );
}

function Card({
  icon, title, children,
}: {
  icon?: string; title: string; children: React.ReactNode; tone?: 'muted';
}) {
  return (
    <div className="card">
      {icon && <div className="icon">{icon}</div>}
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

function Yes({ value }: { value: string }) {
  if (value === 'yes')   return <span className="yes">●</span>;
  if (value === 'no')    return <span className="no">○</span>;
  if (value === 'n/a')   return <span className="no">—</span>;
  return <span className="no">{value}</span>;
}
