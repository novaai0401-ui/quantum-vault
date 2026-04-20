import { TkxAlert, TkxBadge, TkxCard, TkxCardBody } from 'tekivex-ui';

export default function Quickstart() {
  return (
    <>
      <h1>Quickstart</h1>
      <p className="lead">
        Three paths depending on what you need. Pick the closest one and
        you'll have a signed, verified post-quantum token in under a minute.
      </p>

      <h2>Path 1 — REST server (fastest to see it work)</h2>
      <p>
        One <code>.mjs</code> file, zero npm deps. If you have Node 18+
        installed you're already done.
      </p>

      <pre><code>{`# from the repo root
node qv-server/server-sovereign.mjs

# in another terminal — generate a key, issue a token, verify it
curl -s -X POST http://localhost:7433/v3/keygen \\
     -H 'content-type: application/json' \\
     -d '{"label":"demo"}' | tee /tmp/key.json

KEY_ID=$(jq -r .keyId /tmp/key.json)

curl -s -X POST http://localhost:7433/v3/token/issue \\
     -H 'content-type: application/json' \\
     -d "{\\"keyId\\":\\"$KEY_ID\\",\\"ttl\\":3600,\\"claims\\":{\\"sub\\":\\"alice\\",\\"role\\":\\"admin\\"}}"
`}</code></pre>

      <TkxAlert variant="info" title="What just happened">
        The server generated an ML-DSA-87 keypair, sealed the signing key
        at rest with AES-256-GCM (per-keyId AAD), persisted a mutation
        chain, and handed you a base64url token. No database, no package
        manager, no daemons.
      </TkxAlert>

      <h2>Path 2 — Native FFI (any language)</h2>
      <p>
        Build the shared library once, call it from anywhere that has FFI.
        This path avoids an HTTP hop entirely.
      </p>

      <pre><code>{`cargo build -p qv-ffi --release

# produces one of:
#   target/release/qv.dll        (Windows)
#   target/release/libqv.so      (Linux)
#   target/release/libqv.dylib   (macOS)

python qv-ffi/examples/python/demo.py         # ML-DSA-87 demo
python qv-ffi/examples/python/demo_falcon.py  # Falcon-512 + 1024 demo`}</code></pre>

      <p>See <a href="/languages">Languages</a> for per-language bindings.</p>

      <h2>Path 3 — WebAssembly</h2>
      <p>
        Same engine, 127 KB, runs anywhere WASM runs. The host only has to
        provide one import: <code>qv_host_random(ptr, len) -&gt; i32</code>.
      </p>

      <pre><code>{`rustup target add wasm32-unknown-unknown
cargo build -p qv-wasm --release --target wasm32-unknown-unknown

# 127 KB artifact at:
#   target/wasm32-unknown-unknown/release/qv_wasm.wasm

node qv-wasm/demo-node.mjs   # Node stdlib host — no wasm-bindgen, no npm`}</code></pre>

      <h2>What you need on the build machine</h2>
      <div className="qv-grid two">
        <TkxCard variant="outline">
          <TkxCardBody>
            <h3 style={{ marginTop: 0 }}>
              Always <TkxBadge size="sm" colorScheme="primary">required</TkxBadge>
            </h3>
            <ul>
              <li>Rust stable (<code>rustup</code>)</li>
              <li>A C compiler for Falcon — MinGW on Windows, gcc/clang on Linux/macOS</li>
              <li>Node.js 18+ (only if using the REST server)</li>
            </ul>
          </TkxCardBody>
        </TkxCard>
        <TkxCard variant="outline">
          <TkxCardBody>
            <h3 style={{ marginTop: 0 }}>
              Optional <TkxBadge size="sm" variant="outline">nice-to-have</TkxBadge>
            </h3>
            <ul>
              <li><code>wasm32-unknown-unknown</code> Rust target (<code>rustup target add …</code>) for the WASM build</li>
              <li><code>cargo vendor</code> output in <code>./vendor</code> for air-gapped builds</li>
              <li>.NET / Go / Java toolchains only if running those demos</li>
            </ul>
          </TkxCardBody>
        </TkxCard>
      </div>

      <h2>Environment variables</h2>
      <table>
        <thead>
          <tr><th>Variable</th><th>Purpose</th><th>Default</th></tr>
        </thead>
        <tbody>
          <tr><td><code>QV_PORT</code></td><td>REST server port</td><td>7433</td></tr>
          <tr><td><code>QV_DATA_DIR</code></td><td>Where keystore.json, master.key, chains/ live</td><td><code>./qv-data</code></td></tr>
          <tr><td><code>QV_WORKERS</code></td><td>worker_threads for batch-verify (0 = in-thread)</td><td><code>cpus()-1</code></td></tr>
          <tr><td><code>QV_MASTER_KEY_HEX</code></td><td>Override master key (64 hex chars). If set, no file is written.</td><td>—</td></tr>
        </tbody>
      </table>
    </>
  );
}
