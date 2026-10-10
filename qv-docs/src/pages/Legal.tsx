// SPDX-License-Identifier: Apache-2.0
//
// About, Privacy, Terms and 404. Kept honest and short: this is a static
// documentation site for an open-source project, and the pages say so.

import { Link } from 'react-router-dom';
import { TkxButton } from 'tekivex-ui';
import { Seo, breadcrumbs } from '../lib/seo';
import { REPO, SITE_URL, VERSION } from '../lib/site';

const UPDATED = '2026-10-11';

export function About() {
  return (
    <div className="page">
      <Seo jsonLd={[
        breadcrumbs([{ name: 'Home', path: '/' }, { name: 'About', path: '/about' }]),
        {
          '@context': 'https://schema.org',
          '@type': 'AboutPage',
          name: 'About Sigvault',
          url: SITE_URL + '/about',
          mainEntity: {
            '@type': 'Organization',
            name: 'Sigvault contributors',
            url: SITE_URL + '/',
            sameAs: [REPO, 'https://www.npmjs.com/package/@sigvault/sdk', 'https://crates.io/crates/qv-core'],
          },
        },
      ]} />
      <div className="container-narrow">
        <div className="section-eyebrow">About</div>
        <h1>Built by people who read the dependency tree.</h1>
        <p className="section-lead">
          Sigvault is an open-source post-quantum token issuer and verifier,
          built and maintained by independent contributors. There is no
          company behind it, no hosted plan, and no telemetry. The project
          exists because the migration deadlines are real and the tooling for
          tokens specifically was missing.
        </p>

        <h2>Principles</h2>
        <ul>
          <li><strong>Standard primitives only.</strong> ML-DSA-87 (FIPS 204), Falcon (FIPS 206 track), XChaCha20-Poly1305, SHA3-256. No novel cryptography.</li>
          <li><strong>Minimal dependency surface.</strong> The server runs on the Node.js standard library alone. The SDKs depend only on the audited Noble suite. CI enforces both.</li>
          <li><strong>Sovereign by default.</strong> You run it. You hold the keys. The spec is open so you can reimplement it.</li>
          <li><strong>Reproducible claims.</strong> Every number on this site maps to a test, a benchmark, or a line in the repository.</li>
        </ul>

        <h2>Contact</h2>
        <p>
          The project is developed in the open at{' '}
          <a href={REPO} target="_blank" rel="noreferrer">github.com/novaai0401-ui/quantum-vault</a>.
          Questions, bug reports and feature requests go to{' '}
          <a href={`${REPO}/issues`} target="_blank" rel="noreferrer">GitHub Issues</a>;
          longer discussions to{' '}
          <a href={`${REPO}/discussions`} target="_blank" rel="noreferrer">GitHub Discussions</a>.
        </p>

        <h2>Security disclosure</h2>
        <p>
          Please do not file security vulnerabilities as public issues. The
          disclosure process, supported versions and response targets are in{' '}
          <a href={`${REPO}/blob/main/SECURITY.md`} target="_blank" rel="noreferrer">SECURITY.md</a>.
          Use GitHub's private vulnerability reporting on the repository.
        </p>

        <h2>Licences</h2>
        <p>
          Server: AGPL-3.0-only. SDKs and this website's source: Apache-2.0.
          Specification and storybook: CC BY 4.0. The full map and the reasoning
          behind it are in{' '}
          <a href={`${REPO}/blob/main/LICENSING.md`} target="_blank" rel="noreferrer">LICENSING.md</a>.
          Current release: v{VERSION}.
        </p>

        <div className="cta-row">
          <Link to="/privacy"><TkxButton variant="outline" colorScheme="neutral">Privacy policy</TkxButton></Link>
          <Link to="/terms"><TkxButton variant="ghost" colorScheme="neutral">Terms of use</TkxButton></Link>
        </div>
      </div>
    </div>
  );
}

export function Privacy() {
  return (
    <div className="page">
      <Seo jsonLd={[breadcrumbs([{ name: 'Home', path: '/' }, { name: 'Privacy', path: '/privacy' }])]} />
      <div className="container-narrow">
        <div className="section-eyebrow">Privacy policy</div>
        <h1>What this site collects. Mostly nothing.</h1>
        <p className="section-lead">Last updated {UPDATED}.</p>

        <h2>Summary</h2>
        <ul>
          <li>This website is a static site. It has no accounts, no sign-up forms and no tracking pixels operated by the project.</li>
          <li>The project sets no cookies of its own.</li>
          <li>The in-browser demo generates keys and tokens locally in your browser's memory. Nothing you type into the demo is sent to any server.</li>
        </ul>

        <h2>Hosting</h2>
        <p>
          The site is served by a static hosting provider. Like any web server,
          the provider may keep short-lived access logs containing your IP
          address, user agent and the pages requested, for the purpose of
          operating and securing the service. The project does not receive or
          analyse these logs.
        </p>

        <h2>Third-party resources</h2>
        <p>
          Typefaces are loaded from Google Fonts. When your browser fetches a
          font file, Google receives your IP address as part of that request.
          Google's handling of that data is described in its own privacy
          policy. No other third-party scripts are loaded by this site.
        </p>
        <p>
          Links to GitHub, npm, crates.io and standards bodies take you to
          sites with their own policies.
        </p>

        <h2>The demo page and the optional API</h2>
        <p>
          The live demo runs the full post-quantum signing path inside your
          browser using WebAssembly and JavaScript. If you deliberately point
          the demo at a server you operate, requests go to that server and
          are governed by your own configuration.
        </p>

        <h2>Children</h2>
        <p>This site is a technical reference and is not directed at children under 13.</p>

        <h2>Changes</h2>
        <p>
          Changes to this policy are made by editing the page source in the
          public repository, so the full history is visible in{' '}
          <a href={`${REPO}/commits/main/qv-docs/src/pages/Legal.tsx`} target="_blank" rel="noreferrer">the git log</a>.
        </p>

        <h2>Contact</h2>
        <p>Privacy questions can be raised through <a href={`${REPO}/issues`} target="_blank" rel="noreferrer">GitHub Issues</a>.</p>
      </div>
    </div>
  );
}

export function Terms() {
  return (
    <div className="page">
      <Seo jsonLd={[breadcrumbs([{ name: 'Home', path: '/' }, { name: 'Terms', path: '/terms' }])]} />
      <div className="container-narrow">
        <div className="section-eyebrow">Terms of use</div>
        <h1>Plain terms for a documentation site.</h1>
        <p className="section-lead">Last updated {UPDATED}.</p>

        <h2>The website</h2>
        <p>
          This website documents the Sigvault open-source project. Its content
          is provided for information. You may read, link to and quote it.
          The written content of the storybook and specification is licensed
          under CC BY 4.0; the website source code is Apache-2.0.
        </p>

        <h2>The software</h2>
        <p>
          The Sigvault server, SDKs, binaries and container images are governed
          exclusively by their own licences (AGPL-3.0-only for the server,
          Apache-2.0 for the SDKs). Nothing on this site changes those terms.
          The software is provided "as is", without warranty of any kind, as
          those licences state.
        </p>

        <h2>No professional advice</h2>
        <p>
          Dates and requirements quoted from NIST, the NSA, the European
          Commission and the UK NCSC are summarised from their public documents
          and link to the originals. They are not legal or compliance advice.
          Confirm obligations against the primary sources for your sector.
        </p>

        <h2>Acceptable use</h2>
        <p>
          Do not attempt to disrupt the site, scrape it at a rate that affects
          other visitors, or use it to attack third parties. Automated agents
          and search crawlers are welcome and should follow <code>robots.txt</code>.
        </p>

        <h2>Contact</h2>
        <p>Questions about these terms: <a href={`${REPO}/issues`} target="_blank" rel="noreferrer">GitHub Issues</a>.</p>
      </div>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="page">
      <Seo title="Page not found — Sigvault" description="That page does not exist." noindex />
      <div className="container-narrow" style={{ textAlign: 'center' }}>
        <div className="section-eyebrow">404</div>
        <h1>Nothing is signed at this address.</h1>
        <p className="section-lead" style={{ margin: '0 auto' }}>
          The page you asked for does not exist or has moved.
        </p>
        <div className="cta-row" style={{ justifyContent: 'center' }}>
          <Link to="/"><TkxButton variant="solid" colorScheme="primary">Back to the start</TkxButton></Link>
          <Link to="/storybook"><TkxButton variant="outline" colorScheme="neutral">Browse the storybook</TkxButton></Link>
        </div>
      </div>
    </div>
  );
}
