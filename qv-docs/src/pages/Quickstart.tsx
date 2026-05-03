// SPDX-License-Identifier: Apache-2.0
import { Link } from 'react-router-dom';

export default function Quickstart() {
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

        <h2>1. Run the server</h2>
        <p>
          Pull the signed image. The container ships with reproducible
          builds and a CycloneDX 1.5 SBOM as an OCI attestation.
        </p>
        <pre><code>{`# Optional: verify the image before running.
cosign verify ghcr.io/007krcs/qv-server:4.3.0 \\
  --certificate-identity-regexp "^https://github.com/007krcs/quantum-vault" \\
  --certificate-oidc-issuer https://token.actions.githubusercontent.com

# Mint an admin token (one-time, store its hash in your secret manager).
docker run --rm ghcr.io/007krcs/qv-server:4.3.0 npm run mint-token

# Run.
docker run --rm -p 7433:7433 \\
  -e QV_ADMIN_TOKEN_SHA256=$ADMIN_TOKEN_SHA256 \\
  -e QV_MASTER_KEY_HEX=$(openssl rand -hex 32) \\
  -v $PWD/qv-data:/data \\
  ghcr.io/007krcs/qv-server:4.3.0`}</code></pre>

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
  -d '{"keyId":"<your-key-id>","claims":{"sub":"alice","role":"admin"}}'

# Verify
curl -fsS http://127.0.0.1:7433/v3/token/verify \\
  -H "Content-Type: application/json" \\
  -d '{"keyId":"<your-key-id>","token":"<token-hex-from-issue>"}'`}</code></pre>

        <h2>From your application</h2>
        <p>
          Use the SDK appropriate to your runtime. All seven SDKs
          have the same interface and a shared conformance test suite.
        </p>

        <h3>Node.js / TypeScript</h3>
        <pre><code>{`import { generateKeypair, MutationChain, issueToken, verifyToken } from '@sigvault/sdk';

const { signingKey, verifyingKey, encryptKey } = generateKeypair();
const chain = new MutationChain();

const { tokenHex } = issueToken({
  signingKeySeed: signingKey,
  encryptKey,
  chain,
  claims: { sub: 'alice', role: 'admin' },
  ttl: 3600,
});

const verified = verifyToken({
  token: tokenHex, verifyingKey, encryptKey, chain,
});`}</code></pre>

        <h3>Python</h3>
        <pre><code>{`from sigvault import Client

c = Client("http://127.0.0.1:7433", admin_token=ADMIN_TOKEN)
key_id = c.keygen("my-key")
token = c.issue(key_id, claims={"sub": "alice"})
result = c.verify(key_id, token)`}</code></pre>

        <h3>Go</h3>
        <pre><code>{`import "github.com/007krcs/quantum-vault/qv-sdk/go"

c := sigvault.NewClient("http://127.0.0.1:7433").WithAdminToken(token)
ctx := context.Background()
keyID, _ := c.Keygen(ctx, "my-key")
res, _ := c.Issue(ctx, keyID, map[string]any{"sub": "alice"})
v, _ := c.Verify(ctx, keyID, res.TokenHex)`}</code></pre>

        <h2>What's next</h2>
        <ul>
          <li>
            Read <Link to="/concepts">How it works</Link> for the
            cryptographic guarantees and the architectural reasoning.
          </li>
          <li>
            Read <Link to="/architecture">Architecture</Link> for the
            request lifecycle, observability, and operational topology.
          </li>
          <li>
            Read the <a href="https://github.com/007krcs/quantum-vault/tree/main/docs/story" target="_blank" rel="noreferrer">storybook</a>{' '}
            for the chapter-by-chapter rationale of every decision.
          </li>
        </ul>
      </div>
    </div>
  );
}
