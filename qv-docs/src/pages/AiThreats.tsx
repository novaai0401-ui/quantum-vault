// SPDX-License-Identifier: Apache-2.0
//
// AI changes the economics of attack: reconnaissance, credential stuffing,
// dependency poisoning and token forgery can all run at machine speed
// with no human in the loop. Every claim on this page maps to a shipped
// control in the repository (see HARDENING.md and qv-server/). Nothing
// here promises what the code does not do.

import { Link } from 'react-router-dom';
import { TkxAlert, TkxButton } from 'tekivex-ui';
import { Seo, breadcrumbs, faqPage } from '../lib/seo';
import { REPO } from '../lib/site';

interface Threat {
  name: string;
  how: string;      // what an AI-driven attacker does
  control: string;  // what Sigvault does about it, structurally
  where: string;    // file or doc in the repo
  href: string;
}

const THREATS: Threat[] = [
  {
    name: 'Automated token forgery after harvesting',
    how: 'Agents record traffic now and queue it for the day a cryptographically relevant quantum computer can recover RSA or ECDSA private keys from public signatures.',
    control: 'Signatures are ML-DSA-87 (FIPS 204) or Falcon. There is no classical signature to recover. Claims are additionally sealed with XChaCha20-Poly1305, so a captured token reveals nothing even if the verifier key leaks.',
    where: 'qv-core, qv-spec',
    href: `${REPO}/tree/main/qv-spec`,
  },
  {
    name: 'Replay at scale',
    how: 'A fleet of agents captures valid tokens and replays them against every endpoint it can enumerate, faster than a human review could notice.',
    control: 'Every token is bound to a per-key mutation-chain counter linked by SHA3-256 to its predecessor. A replayed token is rejected by construction, with no replay cache to fill and no clock-skew window to exploit.',
    where: 'qv-server/chain-log.mjs',
    href: `${REPO}/blob/main/qv-server/chain-log.mjs`,
  },
  {
    name: 'Dependency poisoning',
    how: 'LLM-assisted attackers publish look-alike packages, hijack maintainers, or hide payloads in transitive dependencies. The XZ-utils backdoor took two years of patient social engineering; a model can run a thousand such campaigns at once.',
    control: 'The server has zero npm runtime dependencies and CI fails any commit that adds one. The SDK allows exactly three audited Noble packages. There is no transitive graph for an attacker to enter.',
    where: 'qv-ops/scripts/dep-audit.mjs',
    href: `${REPO}/blob/main/qv-ops/scripts/dep-audit.mjs`,
  },
  {
    name: 'Credential stuffing and brute force',
    how: 'Agents cycle through leaked admin tokens and API keys across thousands of hosts, pacing requests to stay under naive thresholds.',
    control: 'Bearer-token auth with auth-failure rate limiting, composed with per-IP and per-keyId limits. A noisy tenant cannot drain the shared bucket. Admin and metrics endpoints sit behind a CIDR allowlist.',
    where: 'qv-server/ratelimit.mjs, cidr.mjs, auth.mjs',
    href: `${REPO}/blob/main/qv-server/ratelimit.mjs`,
  },
  {
    name: 'Silent tampering of state',
    how: 'An attacker with filesystem or database access edits a counter or a record so that a forged token appears to be in sequence.',
    control: 'The chain log is hash-linked. On boot the server replays the chain, verifies every link, and refuses to start if any record was altered. In Postgres mode the PRIMARY KEY guarantees exactly one writer wins a race.',
    where: 'qv-server/chain-store-postgres.mjs',
    href: `${REPO}/blob/main/qv-server/chain-store-postgres.mjs`,
  },
  {
    name: 'Supply-chain substitution of the artefact itself',
    how: 'A compromised registry serves a modified image under a familiar tag.',
    control: 'Images are pinned by digest as well as tag, signed with Sigstore cosign against a GitHub Actions OIDC identity, and carry a CycloneDX SBOM. Operators verify before deploy.',
    where: '.github/workflows/release.yml',
    href: `${REPO}/blob/main/.github/workflows/release.yml`,
  },
  {
    name: 'Resource exhaustion through crafted payloads',
    how: 'Fuzzing agents generate oversized or malformed bodies to crash workers or starve the verify pool.',
    control: 'Body, claims-size and shape caps are enforced before any cryptography runs. Verification runs in a bounded worker pool with explicit queue rejection, and the rejection counter is exported as a metric.',
    where: 'qv-server/security.mjs, verify-pool.mjs',
    href: `${REPO}/blob/main/qv-server/verify-pool.mjs`,
  },
  {
    name: 'Invisible compromise',
    how: 'The attack succeeds and nobody knows, because the logs are unstructured or were never shipped anywhere.',
    control: 'Every request carries a request ID into a structured JSONL audit log with a sensitive-key redaction blocklist. Events forward to any OpenTelemetry collector over OTLP with no extra libraries.',
    where: 'qv-server/audit.mjs, otlp.mjs',
    href: `${REPO}/blob/main/qv-server/audit.mjs`,
  },
];

const FAQ = [
  { q: 'Does Sigvault use AI to detect attacks?',
    a: 'No, and that is deliberate. Detection-based defences race the attacker; the attacker now has the faster model. Sigvault removes the attack surface structurally so there is nothing to detect: no classical signature to break, no replay window, no dependency tree, no unverified state.' },
  { q: 'Can an AI agent still attack a Sigvault deployment?',
    a: 'Yes, at the layers Sigvault does not own: your TLS termination, your identity provider, your host. The hardening guide lists exactly what the project does and does not promise, including memory-resident keys and side-channel research.' },
  { q: 'Why is "zero dependencies" an AI-era defence?',
    a: 'Large language models make social-engineering a maintainer, or generating a convincing malicious package, cheap and parallel. A dependency graph that is empty cannot be entered.' },
  { q: 'What happens if a worker or a disk is compromised?',
    a: 'The chain log is hash-linked, so edits are detected on the next boot and the server refuses to start. The master key never leaves the pluggable secrets manager you chose.' },
];

export default function AiThreats() {
  return (
    <div className="page">
      <Seo jsonLd={[
        breadcrumbs([{ name: 'Home', path: '/' }, { name: 'AI-era threats', path: '/ai-threats' }]),
        faqPage(FAQ),
      ]} />
      <div className="container-narrow">
        <div className="section-eyebrow">AI-era threat model</div>
        <h1>When the attacker is a model, structure beats detection.</h1>
        <p className="section-lead">
          AI does not invent new attacks so much as remove the cost of the
          old ones. Reconnaissance, replay, dependency poisoning and
          credential stuffing now run at machine speed with no human in the
          loop. Sigvault's answer is to make each of those attacks
          structurally impossible rather than merely detectable. Every row
          below links to the code that enforces it.
        </p>

        <TkxAlert variant="info" title="Honest scope" style={{ marginTop: 20 }}>
          Sigvault secures the token layer: issuance, verification, keys and
          state. It does not replace your WAF, your TLS termination or your
          identity provider. What it does not promise is written down in{' '}
          <a href={`${REPO}/blob/main/HARDENING.md`} target="_blank" rel="noreferrer">HARDENING.md</a>.
        </TkxAlert>

        <h2>Eight attacks, eight structural answers</h2>
        <div className="threats">
          {THREATS.map((t) => (
            <article key={t.name} className="threat">
              <h3>{t.name}</h3>
              <div className="threat-row">
                <span className="threat-label attack">The attack</span>
                <p>{t.how}</p>
              </div>
              <div className="threat-row">
                <span className="threat-label control">The control</span>
                <p>{t.control}</p>
              </div>
              <a href={t.href} target="_blank" rel="noreferrer" className="threat-src">
                In the repo: <code>{t.where}</code> ↗
              </a>
            </article>
          ))}
        </div>

        <h2>The principle</h2>
        <p>
          A defence that depends on noticing an attack loses once the
          attacker can try more variations per second than the defender can
          review. A defence that depends on mathematics does not care how
          many attempts are made. Post-quantum signatures, hash-linked state,
          an empty dependency graph and public-key verification are all in
          the second category. That is the whole design.
        </p>

        <h2>Frequently asked</h2>
        <dl className="faq">
          {FAQ.map(({ q, a }) => (
            <div key={q} className="faq-item">
              <dt>{q}</dt>
              <dd>{a}</dd>
            </div>
          ))}
        </dl>

        <div className="cta-row" style={{ marginTop: 40 }}>
          <Link to="/demo">
            <TkxButton variant="solid" colorScheme="primary" size="lg">
              Tamper with a token yourself →
            </TkxButton>
          </Link>
          <a href={`${REPO}/blob/main/HARDENING.md`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
            <TkxButton variant="outline" colorScheme="neutral" size="lg">
              Read the hardening guide
            </TkxButton>
          </a>
        </div>
      </div>
    </div>
  );
}
