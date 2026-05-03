import { TkxAlert, TkxBadge, TkxCard, TkxCardBody, TkxDivider } from 'tekivex-ui';

export default function Architecture() {
  return (
    <>
      <h1>Architecture</h1>
      <p className="lead">
        Sigvault is organised as a small Rust core with narrow
        embedding surfaces. The core knows how to mint, verify, and
        mutate tokens. Everything else — HTTP, FFI, WASM, language
        bindings — is a thin adapter that forwards bytes into that core.
      </p>

      <h2>Repo layout</h2>
      <table>
        <thead>
          <tr><th style={{ width: 160 }}>Crate / dir</th><th>What it contains</th></tr>
        </thead>
        <tbody>
          <tr><td><code>qv-core</code></td><td>Rust library — tokens, claims, signatures, mutation chain, Falcon.</td></tr>
          <tr><td><code>qv-ffi</code></td><td>C ABI wrapper. Builds <code>qv.dll</code> / <code>libqv.so</code> / <code>libqv.dylib</code>.</td></tr>
          <tr><td><code>qv-wasm</code></td><td>WebAssembly wrapper. Custom getrandom shim, one host import.</td></tr>
          <tr><td><code>qv-sdk</code></td><td>JavaScript SDK (Node stdlib only). Used by the server and Node clients.</td></tr>
          <tr><td><code>qv-server</code></td><td>REST server — <code>server-sovereign.mjs</code>, zero npm deps.</td></tr>
          <tr><td><code>qv-cli</code></td><td>Optional CLI front-end for operators.</td></tr>
          <tr><td><code>qv-docs</code></td><td>This site — Vite + React + <a href="https://www.npmjs.com/package/tekivex-ui">tekivex-ui</a>.</td></tr>
          <tr><td><code>vendor/</code></td><td>Vendored Rust source (offline-buildable supply chain).</td></tr>
        </tbody>
      </table>

      <h2>Dependency elimination</h2>
      <p>
        Every surface has a deliberate rule about what may be pulled in.
        When a dep sneaks in, we eliminate it rather than accept it.
      </p>
      <div className="qv-grid two">
        <TkxCard variant="elevated">
          <TkxCardBody>
            <h3 style={{ marginTop: 0 }}>Server · <TkxBadge size="sm" colorScheme="success">0 npm</TkxBadge></h3>
            <p className="qv-mut">
              Only Node stdlib: <code>http</code>, <code>crypto</code>,{' '}
              <code>fs</code>, <code>path</code>, <code>worker_threads</code>,
              <code> os</code>, <code>zlib</code>.
            </p>
          </TkxCardBody>
        </TkxCard>
        <TkxCard variant="elevated">
          <TkxCardBody>
            <h3 style={{ marginTop: 0 }}>WASM · <TkxBadge size="sm" colorScheme="success">1 host import</TkxBadge></h3>
            <p className="qv-mut">
              <code>qv_host_random(ptr, len)</code>. No wasm-bindgen, no
              JS glue, no npm post-install.
            </p>
          </TkxCardBody>
        </TkxCard>
        <TkxCard variant="elevated">
          <TkxCardBody>
            <h3 style={{ marginTop: 0 }}>FFI · <TkxBadge size="sm" colorScheme="success">plain C ABI</TkxBadge></h3>
            <p className="qv-mut">
              Pure functions, caller-allocated buffers, no handles. Works
              from any language with <code>dlopen</code> / <code>LoadLibrary</code>.
            </p>
          </TkxCardBody>
        </TkxCard>
        <TkxCard variant="elevated">
          <TkxCardBody>
            <h3 style={{ marginTop: 0 }}>Rust · <TkxBadge size="sm" variant="outline">vendored</TkxBadge></h3>
            <p className="qv-mut">
              <code>cargo vendor vendor</code> pulls every crate into the
              repo. Build with no network, no crates.io, no surprises.
            </p>
          </TkxCardBody>
        </TkxCard>
      </div>

      <h2>Token wire format</h2>
      <p>
        Little-endian, magic-prefixed, version-byte first. An inspector
        can read the header without any keys.
      </p>
      <pre><code>{`┌───────┬────────┬─────────┬───────────┬─────────────┬──────────┬────────────┐
│ MAGIC │ VERSION│  SUITE  │ TOKEN_TYPE│  MUT_CTR    │ CLAIMS(N)│ SIG(sigLen)│
│  4 B  │  1 B   │   1 B   │    1 B    │    8 B      │          │            │
│"QVLT" │  0x03  │ 0x05=…  │ 0x00=acc  │ u64 LE      │ enc blob │ variable/  │
│       │        │         │           │             │          │ fixed      │
└───────┴────────┴─────────┴───────────┴─────────────┴──────────┴────────────┘`}</code></pre>
      <p>
        Claims are encrypted with ChaCha20-Poly1305 using a key derived
        from the server's per-key material. Payload optionally{' '}
        <code>deflate</code>-compressed (marker byte preserves backward
        compat).
      </p>

      <h2>Security properties</h2>
      <table>
        <thead>
          <tr><th>Property</th><th>How it's enforced</th></tr>
        </thead>
        <tbody>
          <tr><td>Post-quantum signatures</td><td>ML-DSA-87 (FIPS 204) default; Falcon-512/1024 opt-in.</td></tr>
          <tr><td>Claims confidentiality</td><td>ChaCha20-Poly1305 AEAD with per-key encryption key.</td></tr>
          <tr><td>Signing keys at rest</td><td>AES-256-GCM envelope, master key in <code>master.key</code> (mode 0600) or <code>QV_MASTER_KEY_HEX</code> env.</td></tr>
          <tr><td>Replay protection</td><td>Append-only mutation chain per keyId, SHA3-256 hash chain, monotonic counter.</td></tr>
          <tr><td>Revocation</td><td>Persistent <code>revoked.json</code>; all endpoints return 410 Gone for revoked keys.</td></tr>
          <tr><td>Entropy certification</td><td>Claims payload must not compress below a floor — rejects malformed/low-entropy claims.</td></tr>
          <tr><td>Key swap resistance</td><td>AEAD AAD binds each sealed key to its keyId (can't move a blob between slots).</td></tr>
        </tbody>
      </table>

      <TkxDivider style={{ margin: '32px 0' }} />

      <h2>Performance snapshot (v4.1)</h2>
      <pre><code>{`ML-DSA-87   sig 4627 B   verify   1.24 ms  (1107 /s from Python FFI)
Falcon-512  sig  656 B   verify   0.14 ms  (6990 /s from Python FFI)   ← 7.1× smaller
Falcon-1024 sig 1266 B   verify   0.26 ms  (3808 /s from Python FFI)
WASM  ML-DSA-87         verify   0.71 ms  (1418 /s in Node, 127 KB .wasm)
Batch-verify 4 workers                      558 /s end-to-end (HTTP + pool)
Batch-verify in-thread                      158 /s end-to-end`}</code></pre>

      <h2>Threat model — what it protects against</h2>
      <table>
        <thead>
          <tr><th>Threat</th><th>Mitigated?</th></tr>
        </thead>
        <tbody>
          <tr><td>Harvest-now-decrypt-later (CRQC forgery)</td><td><TkxBadge size="sm" colorScheme="success">yes</TkxBadge> — PQ signatures</td></tr>
          <tr><td>Stolen server disk (signing keys)</td><td><TkxBadge size="sm" colorScheme="success">yes</TkxBadge> — AES-GCM sealed, master key separable</td></tr>
          <tr><td>Compromised npm dep shipping malware</td><td><TkxBadge size="sm" colorScheme="success">yes</TkxBadge> — server has zero npm deps</td></tr>
          <tr><td>Token replay after use</td><td><TkxBadge size="sm" colorScheme="success">yes</TkxBadge> — mutation chain monotonic counter</td></tr>
          <tr><td>Revoked-key reuse</td><td><TkxBadge size="sm" colorScheme="success">yes</TkxBadge> — persistent revocation list</td></tr>
          <tr><td>Compromised application host (memory read)</td><td><TkxBadge size="sm" colorScheme="warning">partial</TkxBadge> — zeroize on drop; HSM integration roadmapped</td></tr>
          <tr><td>TLS in transit</td><td><TkxBadge size="sm" variant="outline">out of scope</TkxBadge> — terminate at your reverse proxy</td></tr>
        </tbody>
      </table>

      <TkxAlert variant="info" title="v4.1 roadmap — what's already in">
        <ul style={{ margin: '6px 0' }}>
          <li>Falcon-512 / Falcon-1024 live through qv-core, qv-ffi, and Python demos.</li>
          <li>True multi-core batch-verify via <code>worker_threads</code> (3.5× speedup on 4 cores).</li>
          <li>WASM unblocked via custom getrandom shim — single host import.</li>
        </ul>
      </TkxAlert>

      <TkxAlert variant="warning" title="Pending for v4.2+">
        <ul style={{ margin: '6px 0' }}>
          <li>Re-vendor after Falcon crates landed (one <code>cargo vendor</code> run).</li>
          <li>Integrate Falcon suites into <code>issue_token</code> / <code>verify_token</code> dispatch.</li>
          <li>JS SDK Falcon adapter + <code>registerSuite</code> wiring.</li>
          <li>Cluster-safe mutation chain (currently single-node file-backed).</li>
          <li>HSM / DPAPI / OS-keyring integration for master key.</li>
          <li>Falcon on wasm32 — requires pure-Rust Falcon once audited.</li>
        </ul>
      </TkxAlert>
    </>
  );
}
