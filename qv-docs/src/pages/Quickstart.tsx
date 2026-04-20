import { TkxAlert, TkxBadge, TkxCard, TkxCardBody, TkxTabs, TkxTabList, TkxTab, TkxTabPanel } from 'tekivex-ui';

export default function Quickstart() {
  return (
    <>
      <h1>Install &amp; Quickstart</h1>
      <p className="lead">
        QuantumVault ships on every major package registry. Pick the
        ecosystem you already use — you'll have a signed, verified
        post-quantum token in under a minute, no <code>git clone</code>
        required.
      </p>

      <h2>Install</h2>
      <TkxTabs>
        <TkxTabList>
          <TkxTab>JavaScript / Node</TkxTab>
          <TkxTab>Browser / Workers</TkxTab>
          <TkxTab>Rust</TkxTab>
          <TkxTab>REST (Docker)</TkxTab>
          <TkxTab>C / Go / C# / Swift</TkxTab>
        </TkxTabList>

        <TkxTabPanel>
          <pre><code>{`npm install @quantumvault/sdk`}</code></pre>
          <p>
            Works in Node 18+, Deno, Bun, and Cloudflare Workers. Pure
            JavaScript — no native build step, no post-install scripts.
            Depends only on <code>@noble/*</code> packages.
          </p>
        </TkxTabPanel>

        <TkxTabPanel>
          <pre><code>{`npm install @quantumvault/wasm`}</code></pre>
          <p>
            127 KB <code>.wasm</code> + a tiny portable loader. Works in
            browsers, Workers, Deno, and Node. Auto-wires one host import
            (<code>qv_host_random</code>) to the platform's CSPRNG.
          </p>
        </TkxTabPanel>

        <TkxTabPanel>
          <pre><code>{`cargo add qv-core --features falcon`}</code></pre>
          <p>
            ML-DSA-87 + Falcon-512/1024 out of the box. Falcon requires a
            C toolchain; build with <code>default-features = false</code>
            for ML-DSA-only (e.g. on <code>wasm32-unknown-unknown</code>).
          </p>
        </TkxTabPanel>

        <TkxTabPanel>
          <pre><code>{`docker run -p 7433:7433 \\
  -e QV_MASTER_KEY_HEX=$(openssl rand -hex 32) \\
  ghcr.io/007krcs/qv-server:4.2`}</code></pre>
          <p>
            Multi-arch image (<code>linux/amd64</code> + <code>linux/arm64</code>),
            ~60 MB, runs as non-root. Zero npm dependencies — Node stdlib only.
          </p>
        </TkxTabPanel>

        <TkxTabPanel>
          <pre><code>{`# pick the triple matching your platform
curl -LO https://github.com/007krcs/quantum-vault/releases/latest/download/libqv-x86_64-unknown-linux-gnu.tar.gz
tar -xzf libqv-*.tar.gz
# → libqv.so + qv.h — link and go
`}</code></pre>
          <p>
            Prebuilt libraries for Linux (x86_64 + arm64), macOS (Intel + Apple
            Silicon), and Windows x86_64. Each archive ships the native library,
            the C header, LICENSE, and README.
          </p>
        </TkxTabPanel>
      </TkxTabs>

      <h2>30-second demo — JavaScript</h2>
      <pre><code>{`import {
  generateKeypair, MutationChain,
  issueToken, verifyToken,
} from '@quantumvault/sdk';

// 1. one-time setup
const { signingKey, verifyingKey, encryptKey } = generateKeypair();
const chain = new MutationChain();

// 2. issue
const { tokenHex } = issueToken({
  signingKeySeed: signingKey, encryptKey, chain,
  claims: { sub: 'user-123', role: 'admin' },
  ttl: 3600,
});

// 3. verify (on the recipient side)
const { claims } = verifyToken({
  token: tokenHex, verifyingKey, encryptKey,
  chain: new MutationChain(chain.state),
});

console.log(claims); // { sub: 'user-123', role: 'admin' }`}</code></pre>

      <h2>30-second demo — Rust</h2>
      <pre><code>{`use qv_core::{
    Claims, IssueParams, MutationChain, SuiteId, TokenType,
    generate_keypair, issue_token, verify_token,
};

let (sk, vk) = generate_keypair()?;
let ek = [0xAB; 32];
let mut chain = MutationChain::new([0; 32]);

let mut claims = Claims::new();
claims.insert("sub", "user-123");

let token = issue_token(IssueParams {
    suite: SuiteId::Dilithium5,
    token_type: TokenType::Access,
    ttl_secs: 3600,
    device_fp: None,
    claims: &claims,
    signing_key: &sk,
    encrypt_key: &ek,
    chain: &mut chain,
})?;

let bytes = token.to_bytes();
let parsed = qv_core::QVRawToken::from_bytes(&bytes)?;
let out = verify_token(&parsed, &vk, &ek,
    &MutationChain::from_state([0; 32], 0))?;
assert_eq!(out.claims.get("sub"), Some("user-123"));`}</code></pre>

      <h2>30-second demo — REST</h2>
      <pre><code>{`# Start the server (or point at ghcr.io/007krcs/qv-server:4.2).
docker run -d -p 7433:7433 \\
  -e QV_MASTER_KEY_HEX=$(openssl rand -hex 32) \\
  ghcr.io/007krcs/qv-server:4.2

# 1. keygen
KEY_ID=$(curl -s -X POST http://localhost:7433/v3/keygen \\
         -H 'content-type: application/json' \\
         -d '{"label":"demo"}' | jq -r .keyId)

# 2. issue
curl -s -X POST http://localhost:7433/v3/token/issue \\
     -H 'content-type: application/json' \\
     -d "{\\"keyId\\":\\"$KEY_ID\\",\\"ttl\\":3600,\\"claims\\":{\\"sub\\":\\"alice\\"}}"

# 3. verify comes back in the same response — or POST /v3/token/verify later.`}</code></pre>

      <TkxAlert variant="info" title="Which surface should I pick?">
        <strong>Front-end or isomorphic JS?</strong> <code>@quantumvault/sdk</code>.
        <br/>
        <strong>Browser bundle size matters?</strong> <code>@quantumvault/wasm</code> (~48 KB gzipped).
        <br/>
        <strong>Rust backend?</strong> <code>qv-core</code> with the <code>falcon</code> feature.
        <br/>
        <strong>Polyglot stack (Python, Go, Java, C#, Swift)?</strong> REST server via Docker,
        or the prebuilt <code>libqv</code> + ctypes/cgo/P-Invoke.
      </TkxAlert>

      <h2>Building from source (contributors only)</h2>
      <div className="qv-grid two">
        <TkxCard variant="outline">
          <TkxCardBody>
            <h3 style={{ marginTop: 0 }}>
              Always <TkxBadge size="sm" colorScheme="primary">required</TkxBadge>
            </h3>
            <ul>
              <li>Rust stable (<code>rustup</code>)</li>
              <li>A C compiler for Falcon — MinGW on Windows, gcc/clang on Linux/macOS</li>
              <li>Node.js 18+ (only for the REST server)</li>
            </ul>
          </TkxCardBody>
        </TkxCard>
        <TkxCard variant="outline">
          <TkxCardBody>
            <h3 style={{ marginTop: 0 }}>
              Optional <TkxBadge size="sm" variant="outline">nice-to-have</TkxBadge>
            </h3>
            <ul>
              <li><code>wasm32-unknown-unknown</code> Rust target for the WASM build</li>
              <li><code>cargo vendor</code> output in <code>./vendor</code> for air-gapped builds (already committed)</li>
              <li>.NET / Go / Java toolchains only if running those demos</li>
            </ul>
          </TkxCardBody>
        </TkxCard>
      </div>

      <h2>REST server environment variables</h2>
      <table>
        <thead>
          <tr><th>Variable</th><th>Purpose</th><th>Default</th></tr>
        </thead>
        <tbody>
          <tr><td><code>QV_PORT</code></td><td>REST server port</td><td><code>7433</code></td></tr>
          <tr><td><code>QV_HOST</code></td><td>Bind address</td><td><code>0.0.0.0</code></td></tr>
          <tr><td><code>QV_DATA_DIR</code></td><td>Where keystore.json, master.key, chains/ live</td><td><code>./qv-data</code></td></tr>
          <tr><td><code>QV_WORKERS</code></td><td>worker_threads for batch-verify (0 = in-thread)</td><td><code>cpus()-1</code></td></tr>
          <tr><td><code>QV_CORS_ORIGIN</code></td><td>CORS allow-origin (empty = disabled)</td><td>—</td></tr>
          <tr><td><code>QV_MASTER_KEY_HEX</code></td><td>Override master key (64 hex chars). If set, no file is written.</td><td>—</td></tr>
        </tbody>
      </table>
    </>
  );
}
