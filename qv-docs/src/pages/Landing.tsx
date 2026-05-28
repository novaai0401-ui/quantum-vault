// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  TkxButton, TkxCard, TkxCardBody, TkxBadge, TkxTabs,
  TkxTabList, TkxTab, TkxTabPanels, TkxTabPanel, TkxDivider,
} from 'tekivex-ui';

const INSTALL = {
  npm:    `npm install @sigvault/sdk`,
  python: `pip install sigvault`,
  go:     `import "github.com/novaai0401-ui/quantum-vault/qv-sdk/go"`,
  cargo:  `cargo add qv-core`,
  docker: `docker pull ghcr.io/novaai0401-ui/qv-server:4.3.7`,
} as const;
type InstallKey = keyof typeof INSTALL;

export default function Landing() {
  const [tab, setTab] = useState<InstallKey>('npm');
  const tabKeys = Object.keys(INSTALL) as InstallKey[];
  const tabIndex = tabKeys.indexOf(tab);

  return (
    <>
      {/* ────────── Hero ────────── */}
      <section className="hero">
        <div className="container">
          <TkxBadge variant="solid" colorScheme="primary" size="sm" style={{ marginBottom: 24 }}>
            v4.3 · Production · Quantum-safe
          </TkxBadge>
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
            <Link to="/demo">
              <TkxButton variant="solid" colorScheme="primary" size="lg">
                Try it in your browser →
              </TkxButton>
            </Link>
            <Link to="/quickstart">
              <TkxButton variant="outline" colorScheme="neutral" size="lg">
                Quickstart (60 seconds)
              </TkxButton>
            </Link>
            <a
              href="https://github.com/novaai0401-ui/quantum-vault"
              target="_blank" rel="noreferrer"
              style={{ textDecoration: 'none' }}
            >
              <TkxButton variant="ghost" colorScheme="neutral" size="lg">
                Source on GitHub
              </TkxButton>
            </a>
          </div>

          <div className="hero-stats">
            <Stat n="0"   label="npm dependencies in the server" />
            <Stat n="341" label="tests, ~30 s, three operating systems" />
            <Stat n="3"   label="post-quantum suites — ML-DSA-87, Falcon-512/1024" />
            <Stat n="7"   label="first-party SDK languages" />
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
            <FeatureCard
              icon="◇"
              title="Harvest now, decrypt later"
              body="An adversary capturing your tokens today can break their signatures retroactively the moment a cryptographically-relevant quantum computer exists. Sigvault closes that window structurally."
            />
            <FeatureCard
              icon="◈"
              title="NIST-standard primitives only"
              body="ML-DSA-87 is FIPS 204. Falcon is on the FIPS 206 path. No experimental schemes, no homegrown crypto, no backdoors-with-good-intentions. Audited reference implementations only."
            />
            <FeatureCard
              icon="◆"
              title="Replay-proof by construction"
              body="Every token carries a per-key MutationChain counter that is cryptographically linked to its predecessors. A replayed token is structurally rejected — no replay cache, no clock-skew window."
            />
          </div>
        </div>
      </section>

      {/* ────────── What ships ────────── */}
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
            <FeatureCard
              icon="✦" title="Zero-dependency server"
              body="qv-server is Node.js stdlib only. No express, no axios, no jsonwebtoken. CI rejects any commit that adds an npm runtime dependency. The 2024 XZ-class supply-chain attack surface is structurally absent here."
            />
            <FeatureCard
              icon="✦" title="Multi-writer Postgres backend"
              body="Horizontal scale via a hand-written zero-dep Postgres wire client. Two writers racing the same chain counter? The PRIMARY KEY guarantees exactly one wins; the loser gets CHAIN_LOG_CONFLICT."
            />
            <FeatureCard
              icon="✦" title="Cryptographic chain log"
              body="Every chain log entry is the SHA3-256 hash of the previous state. Boot replays the chain, verifies linkage, and refuses to start if any record was tampered."
            />
            <FeatureCard
              icon="✦" title="Pluggable secrets manager"
              body="Master key sourced from a file, an env var, or any operator command — AWS KMS, HashiCorp Vault, Azure Key Vault, GCP KMS, 1Password, sops. No vendor lock-in, no native module."
            />
            <FeatureCard
              icon="✦" title="Per-tenant fairness"
              body="Per-IP and per-keyId rate limits compose. A noisy keyId cannot drain the shared bucket. /v3/keys/{id}/quota gives dashboards a real-time view of every tenant's ceiling."
            />
            <FeatureCard
              icon="✦" title="Cosign-signed releases"
              body="Every published image is signed against a GitHub Actions OIDC identity and ships with a CycloneDX 1.5 SBOM as an OCI attestation. Operators verify with cosign verify before deploy."
            />
          </div>
        </div>
      </section>

      {/* ────────── Install tabs ────────── */}
      <section className="block">
        <div className="container-narrow">
          <div className="section-eyebrow">Quick install</div>
          <h2>From "I want to try this" to a verified token in a minute.</h2>
          <p className="section-lead">
            Pick your language. The SDKs share a single wire format and a
            single conformance test suite.
          </p>

          <div style={{ marginTop: 28 }}>
            <TkxTabs
              index={tabIndex}
              onChange={(i) => setTab(tabKeys[i])}
              variant="line"
              colorScheme="primary"
            >
              <TkxTabList>
                {tabKeys.map((k) => <TkxTab key={k}>{k}</TkxTab>)}
              </TkxTabList>
              <TkxTabPanels>
                {tabKeys.map((k) => (
                  <TkxTabPanel key={k}>
                    <pre><code>{INSTALL[k]}</code></pre>
                  </TkxTabPanel>
                ))}
              </TkxTabPanels>
            </TkxTabs>
          </div>

          <div className="cta-row">
            <Link to="/quickstart">
              <TkxButton variant="solid" colorScheme="primary">
                Full quickstart →
              </TkxButton>
            </Link>
            <Link to="/demo">
              <TkxButton variant="ghost" colorScheme="neutral">
                Interactive demo
              </TkxButton>
            </Link>
          </div>
        </div>
      </section>

      {/* ────────── Composition diagram ────────── */}
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
            <div className="node">
              Sigvault Server<br/>
              <span style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>issue · verify</span>
            </div>
            <div className="arrow">→</div>
            <div className="node">
              Your Backend<br/>
              <span style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>any language</span>
            </div>
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

      {/* ────────── Licence ────────── */}
      <section className="block licence-band">
        <div className="container-narrow">
          <div className="section-eyebrow">Licence</div>
          <h2>Open enough to audit. Protected enough to last.</h2>
          <p className="section-lead">
            The server is AGPL-3.0. The SDKs are Apache-2.0. The
            specification is CC BY 4.0. Read every line; run it on your
            own metal; write your own conforming implementation.
            Full rationale in <a
              href="https://github.com/novaai0401-ui/quantum-vault/blob/main/LICENSING.md"
              target="_blank" rel="noreferrer">LICENSING.md</a>.
          </p>

          <div className="grid-3" style={{ marginTop: 32 }}>
            <LicenceCard pill="AGPL-3.0-only" title="Server"
              body="Operators run it freely. SaaS providers comply with §13." />
            <LicenceCard pill="Apache-2.0" title="SDK"
              body="Embed in any product, any licence, no friction." />
            <LicenceCard pill="CC BY 4.0" title="Specification"
              body="Write your own conforming server in any language." />
          </div>
        </div>
      </section>

      {/* ────────── Final CTA ────────── */}
      <section className="block">
        <div className="container-narrow" style={{ textAlign: 'center' }}>
          <h2>The next decade of identity is post-quantum.</h2>
          <p className="section-lead" style={{ margin: '0 auto' }}>
            Start with the demo in your browser. Promote to a real cluster
            when you're ready.
          </p>
          <div className="cta-row" style={{ justifyContent: 'center', marginTop: 28 }}>
            <Link to="/demo">
              <TkxButton variant="solid" colorScheme="primary" size="lg">
                Try the live demo
              </TkxButton>
            </Link>
            <Link to="/storybook">
              <TkxButton variant="outline" colorScheme="neutral" size="lg">
                Read the storybook
              </TkxButton>
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

// ─── Small presentational helpers ──────────────────────────────────────

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <div className="hero-stat">
      <div className="num">{n}</div>
      <div className="lbl">{label}</div>
    </div>
  );
}

function FeatureCard({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <TkxCard variant="outlined" padding="lg" className="tkx-feature">
      <TkxCardBody>
        <div className="icon" aria-hidden>{icon}</div>
        <h3>{title}</h3>
        <p>{body}</p>
      </TkxCardBody>
    </TkxCard>
  );
}

function LicenceCard({ pill, title, body }: { pill: string; title: string; body: string }) {
  return (
    <TkxCard variant="outlined" padding="lg" className="tkx-feature">
      <TkxCardBody>
        <h3 style={{ marginBottom: 10 }}>{title}</h3>
        <TkxBadge variant="subtle" colorScheme="primary" size="sm" style={{ marginBottom: 12 }}>
          {pill}
        </TkxBadge>
        <p>{body}</p>
      </TkxCardBody>
    </TkxCard>
  );
}

function Yes({ value }: { value: string }) {
  if (value === 'yes') return <span className="yes">●</span>;
  if (value === 'no')  return <span className="no">○</span>;
  if (value === 'n/a') return <span className="no">—</span>;
  return <span className="no">{value}</span>;
}
