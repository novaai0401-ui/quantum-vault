// SPDX-License-Identifier: Apache-2.0
//
// The regulatory clock is the strongest argument for Sigvault, and it is
// the question every security lead is asked first: "when do we have to
// move?" This page answers it with dates that come from primary sources,
// then shows where token signing sits in the migration order.

import { Link } from 'react-router-dom';
import { TkxAlert, TkxButton } from 'tekivex-ui';
import { Seo, breadcrumbs, faqPage } from '../lib/seo';

interface Milestone {
  when: string;
  who: string;
  what: string;
  source: string;
  href: string;
}

export const MILESTONES: Milestone[] = [
  {
    when: 'Aug 2024', who: 'NIST',
    what: 'FIPS 203 (ML-KEM), FIPS 204 (ML-DSA) and FIPS 205 (SLH-DSA) published as final standards. ML-DSA-87 is the signature suite Sigvault defaults to.',
    source: 'FIPS 204', href: 'https://csrc.nist.gov/pubs/fips/204/final',
  },
  {
    when: 'Nov 2024', who: 'NIST',
    what: 'IR 8547 (draft) sets the US federal transition schedule: quantum-vulnerable algorithms at 112-bit strength deprecated after 2030, all of them disallowed after 2035.',
    source: 'NIST IR 8547', href: 'https://csrc.nist.gov/pubs/ir/8547/ipd',
  },
  {
    when: 'Mar 2025', who: 'NIST',
    what: 'HQC selected as a second key-encapsulation standard, a backup built on different mathematics than ML-KEM. Falcon (FN-DSA) continues on the FIPS 206 track.',
    source: 'NIST announcement', href: 'https://www.nist.gov/news-events/news/2025/03/nist-selects-hqc-fifth-algorithm-post-quantum-encryption',
  },
  {
    when: 'Mar 2025', who: 'UK NCSC',
    what: 'Three-phase guidance for organisations: discovery and planning by 2028, highest-priority migrations by 2031, full migration by 2035.',
    source: 'NCSC timelines', href: 'https://www.ncsc.gov.uk/guidance/pqc-migration-timelines',
  },
  {
    when: 'Jun 2025', who: 'European Commission',
    what: 'Coordinated implementation roadmap: member states begin migrating by end of 2026, high-risk use cases done by 2030, as much as feasible by 2035.',
    source: 'EU roadmap', href: 'https://digital-strategy.ec.europa.eu/en/library/coordinated-implementation-roadmap-transition-post-quantum-cryptography',
  },
  {
    when: '2025 → 2030', who: 'NSA CNSA 2.0',
    what: 'National-security systems must prefer quantum-resistant software and firmware signing from 2025 and use it exclusively by 2030. Web, cloud and traditional networking follow by 2033; everything by 2035.',
    source: 'CNSA 2.0', href: 'https://media.defense.gov/2022/Sep/07/2003071834/-1/-1/0/CSA_CNSA_2.0_ALGORITHMS_.PDF',
  },
  {
    when: '2030', who: 'NIST',
    what: 'Deprecation line. RSA-2048 and P-256 signatures are deprecated for US federal use. Any token still valid on this date that was signed with them is non-compliant.',
    source: 'NIST IR 8547', href: 'https://csrc.nist.gov/pubs/ir/8547/ipd',
  },
  {
    when: '2035', who: 'NIST · EU · UK · NSA',
    what: 'Every published roadmap converges here: quantum-vulnerable public-key cryptography disallowed.',
    source: 'All of the above', href: 'https://csrc.nist.gov/pubs/ir/8547/ipd',
  },
];

const FAQ = [
  { q: 'Do I need to replace JWT today?',
    a: 'Not overnight, but the signing algorithm underneath it has a published end date. Tokens and the keys that sign them are among the easiest places to migrate, because a token issuer is one service with one key store. Starting there buys time for the harder parts, such as TLS and firmware.' },
  { q: 'Why does "harvest now, decrypt later" apply to tokens?',
    a: 'An attacker who records traffic today can forge or decrypt it once a cryptographically relevant quantum computer exists. Long-lived tokens, refresh tokens and anything archived in logs are exposed for their whole lifetime, not just at issue time.' },
  { q: 'Is ML-DSA-87 standardised?',
    a: 'Yes. ML-DSA is FIPS 204, published by NIST in August 2024. ML-DSA-87 is its highest security category. Falcon is being standardised as FN-DSA under FIPS 206.' },
  { q: 'What is the difference between ML-DSA-87 and Falcon-512 in Sigvault?',
    a: 'Both are NIST post-quantum signature schemes. ML-DSA-87 is the conservative default with the highest security category. Falcon-512 produces signatures roughly seven times smaller and verifies faster, which matters when tokens travel in headers. Sigvault supports both on the same wire format.' },
  { q: 'Can I migrate without changing my backend language?',
    a: 'Yes. Verification is a stateless operation available in JavaScript, Python, Go, Rust, C, Java, PHP, C#, Ruby and WebAssembly, all against one conformance suite, or via the REST server.' },
];

export default function Migration() {
  return (
    <div className="page">
      <Seo jsonLd={[
        breadcrumbs([{ name: 'Home', path: '/' }, { name: 'Migration timeline', path: '/migration' }]),
        faqPage(FAQ),
      ]} />
      <div className="container-narrow">
        <div className="section-eyebrow">Migration timeline</div>
        <h1>The post-quantum deadlines, in one place.</h1>
        <p className="section-lead">
          Every major standards body has now published a date. They do not
          agree on every detail, but they agree on the destination: no
          quantum-vulnerable public-key cryptography by 2035, with the first
          hard deprecations landing in 2030. Each row links to its primary
          source.
        </p>

        <TkxAlert variant="info" title="The real deadline is token lifetime" style={{ marginTop: 20 }}>
          A refresh token issued in 2029 with a one-year lifetime is still
          valid when the 2030 deprecation lands. Count backwards from the
          longest-lived credential you issue.
        </TkxAlert>

        <ol className="timeline" aria-label="Post-quantum migration milestones">
          {MILESTONES.map((m) => (
            <li key={m.when + m.who} className="timeline-item">
              <div className="timeline-when">{m.when}</div>
              <div className="timeline-body">
                <div className="timeline-who">{m.who}</div>
                <p>{m.what}</p>
                <a href={m.href} target="_blank" rel="noreferrer" className="timeline-src">
                  Source: {m.source} ↗
                </a>
              </div>
            </li>
          ))}
        </ol>

        <h2>Where token signing sits in the order of work</h2>
        <p>
          Most migration guides put the hardest systems first: TLS stacks,
          HSMs, firmware signing, PKI hierarchies. Those are multi-year
          programmes. A token issuer is different. It is one service with one
          key store, it already has a rotation path, and both ends of the
          exchange are usually code you own.
        </p>
        <ol>
          <li><strong>Inventory.</strong> List every credential you mint, its lifetime, and the algorithm under it. JWT with RS256 or ES256 is on the clock.</li>
          <li><strong>Issue post-quantum tokens alongside the old ones.</strong> Sigvault runs next to your existing identity provider. Your frontend authenticates as before and asks Sigvault for the token.</li>
          <li><strong>Move verification.</strong> Backends verify locally with an SDK or by calling the server. No shared secret ships to the backend; verification is public-key.</li>
          <li><strong>Retire the old path.</strong> Once every consumer verifies post-quantum tokens, stop issuing the legacy ones. Rotation is one API call.</li>
        </ol>

        <h2>Why the signature choice matters now</h2>
        <p>
          The migration bodies name specific algorithms, not just categories.
          ML-DSA (FIPS 204) is the one every roadmap cites for signatures.
          Sigvault defaults to ML-DSA-87, offers Falcon where signature size
          matters, and encodes the suite in the token itself, so a verifier
          can enforce a policy such as "ML-DSA-87 only" without parsing
          claims.
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
              Sign a post-quantum token now →
            </TkxButton>
          </Link>
          <Link to="/quickstart">
            <TkxButton variant="outline" colorScheme="neutral" size="lg">
              Quickstart
            </TkxButton>
          </Link>
        </div>
      </div>
    </div>
  );
}
