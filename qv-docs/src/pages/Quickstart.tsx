// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  TkxAlert, TkxButton, TkxCard, TkxCardBody, TkxBadge,
  TkxTabs, TkxTabList, TkxTab, TkxTabPanels, TkxTabPanel,
} from 'tekivex-ui';

const SDK_SNIPPETS = {
  Node: `import { generateKeypair, MutationChain, issueToken, verifyToken } from '@sigvault/sdk';

const { signingKey, verifyingKey, encryptKey } = generateKeypair();
const chain = new MutationChain();

const { tokenHex } = issueToken({
  signingKeySeed: signingKey,
  encryptKey, chain,
  claims: { sub: 'alice', role: 'admin' },
  ttl: 3600,
});

const verified = verifyToken({
  token: tokenHex, verifyingKey, encryptKey, chain,
});`,

  Python: `from sigvault import Client

c = Client("http://127.0.0.1:7433", admin_token=ADMIN_TOKEN)
key_id = c.keygen("my-key")
token = c.issue(key_id, claims={"sub": "alice"})
result = c.verify(key_id, token)`,

  Go: `import "github.com/novaai0401-ui/quantum-vault/qv-sdk/go"

c := sigvault.NewClient("http://127.0.0.1:7433").WithAdminToken(token)
ctx := context.Background()
keyID, _ := c.Keygen(ctx, "my-key")
res, _   := c.Issue(ctx, keyID, map[string]any{"sub": "alice"})
v, _     := c.Verify(ctx, keyID, res.TokenHex)`,
};

type SdkLang = keyof typeof SDK_SNIPPETS;

export default function Quickstart() {
  const langs = Object.keys(SDK_SNIPPETS) as SdkLang[];
  const [lang, setLang] = useState<SdkLang>('Node');

  return (
    <div className="page">
      <div className="container-narrow">
        <div className="section-eyebrow">Quickstart</div>
        <h1>From zero to a verified token in 60 seconds.</h1>
        <p className="section-lead">
          Pick the path that matches your stack. Every path produces a
          Sigvault token that any other path can verify — same wire
          format, same conformance test vectors.
        </p>

        <TkxAlert variant="info" title="Want to try without installing anything?"
                  style={{ marginTop: 24 }}>
          The <Link to="/demo">live demo</Link> runs the SDK in your browser. No
          server, no install — issue and verify a real post-quantum token in
          ten seconds.
        </TkxAlert>

        <h2>1. Run the server</h2>
        <p>
          Pull the signed image. The container ships with reproducible
          builds and a CycloneDX 1.5 SBOM as an OCI attestation.
        </p>
        <pre><code>{`# Optional: verify the image before running.
cosign verify ghcr.io/novaai0401-ui/qv-server:4.3.7 \\
  --certificate-identity-regexp "^https://github.com/novaai0401-ui/quantum-vault" \\
  --certificate-oidc-issuer https://token.actions.githubusercontent.com

# Mint an admin token (one-time).
docker run --rm ghcr.io/novaai0401-ui/qv-server:4.3.7 npm run mint-token

# Run.
docker run -d --name sigvault -p 7433:7433 \\
  -e QV_ADMIN_TOKEN_SHA256=$ADMIN_TOKEN_SHA256 \\
  -e QV_MASTER_KEY_HEX=$(openssl rand -hex 32) \\
  -v $PWD/qv-data:/data \\
  ghcr.io/novaai0401-ui/qv-server:4.3.7`}</code></pre>

        <h2>2. Provision a key</h2>
        <pre><code>{`curl -fsS http://127.0.0.1:7433/v3/keygen \\
  -H "Authorization: Bearer $ADMIN_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"label":"my-first-key"}'`}</code></pre>

        <h2>3. Issue and verify a token</h2>
        <pre><code>{`# Issue
curl -fsS http://127.0.0.1:7433/v3/token/issue \\
  -H "Authorization: Bearer $ADMIN_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"keyId":"<keyId>","claims":{"sub":"alice","role":"admin"}}'

# Verify
curl -fsS http://127.0.0.1:7433/v3/token/verify \\
  -H "Content-Type: application/json" \\
  -d '{"keyId":"<keyId>","token":"<token-hex>"}'`}</code></pre>

        <h2>From your application</h2>
        <p>
          Use the SDK appropriate to your runtime. All seven SDKs share
          a single wire format and a single conformance test suite — your
          client code is portable across every backend that speaks Sigvault.
        </p>

        <TkxCard variant="outlined" padding="md" style={{ marginTop: 16 }}>
          <TkxCardBody>
            <TkxTabs
              index={langs.indexOf(lang)}
              onChange={(i) => setLang(langs[i])}
              variant="line"
              colorScheme="primary"
            >
              <TkxTabList>
                {langs.map((l) => <TkxTab key={l}>{l}</TkxTab>)}
              </TkxTabList>
              <TkxTabPanels>
                {langs.map((l) => (
                  <TkxTabPanel key={l}>
                    <pre style={{ marginTop: 16 }}><code>{SDK_SNIPPETS[l]}</code></pre>
                  </TkxTabPanel>
                ))}
              </TkxTabPanels>
            </TkxTabs>
          </TkxCardBody>
        </TkxCard>

        <h2>What's next</h2>
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginTop: 16 }}>
          <NextCard
            badge="Interactive"
            title="Run the demo"
            body="Issue + verify in your browser, no install."
            to="/demo"
          />
          <NextCard
            badge="22 chapters"
            title="Read the storybook"
            body="Why every layer is the way it is."
            to="/storybook"
          />
          <NextCard
            badge="Reference"
            title="Architecture"
            body="Request lifecycle, observability, supply chain."
            to="/architecture"
          />
        </div>
      </div>
    </div>
  );
}

function NextCard({
  badge, title, body, to,
}: { badge: string; title: string; body: string; to: string }) {
  return (
    <Link to={to} style={{ textDecoration: 'none', border: 'none', display: 'block' }}>
      <TkxCard variant="outlined" padding="md" className="tkx-next-card" interactive>
        <TkxCardBody>
          <TkxBadge variant="subtle" colorScheme="primary" size="sm">{badge}</TkxBadge>
          <h3 style={{ margin: '8px 0 4px', fontFamily: 'var(--sans)', fontSize: '1rem' }}>{title}</h3>
          <p style={{ margin: 0, fontSize: '0.94rem', color: 'var(--ink-soft)' }}>{body}</p>
          <TkxButton variant="ghost" colorScheme="primary" size="sm" style={{ marginTop: 12, padding: 0 }}>
            Open →
          </TkxButton>
        </TkxCardBody>
      </TkxCard>
    </Link>
  );
}
