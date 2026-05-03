// SPDX-License-Identifier: Apache-2.0
import { Link } from 'react-router-dom';

export default function Architecture() {
  return (
    <div className="page">
      <div className="container-narrow">
        <div className="section-eyebrow">Architecture</div>
        <h1>One process, one wire format, every backend you already have.</h1>
        <p className="section-lead">
          Sigvault is a single Node.js process backed optionally by a
          Postgres ChainStore. Every other piece — the SDKs, the FFI
          binaries, the WASM bundle — speaks the same wire format and
          passes the same conformance test vectors.
        </p>

        <h2>Topology</h2>
        <pre><code>{`            Frontend                Sigvault Server                 Your Backend
            ─────────                ───────────────                 ─────────────
            Vue / React /            issue   /v3/token/issue         Go / Java / PHP /
            Angular / Svelte   ─►    verify  /v3/token/verify   ─►   .NET / Ruby /
            (any framework)          rotate, identify, quota         Python / Rust / Node

                                          │  optional
                                          ▼
                                   ChainStore backend
                                   (file | postgres)`}</code></pre>

        <p>
          The frontend obtains a token by authenticating against your
          existing IdP and asking Sigvault to issue. The token travels
          to your backend in the <code>Authorization</code> header. The
          backend either verifies locally with the SDK (zero round-trip)
          or asks Sigvault to verify (centralised audit trail).
        </p>

        <h2>The request lifecycle</h2>
        <p>
          A single <code>/v3/token/issue</code> call traverses:
        </p>
        <ol>
          <li><strong>Security headers + CORS</strong> — applied unconditionally.</li>
          <li><strong>CIDR allowlist</strong> — denies traffic outside the configured range.</li>
          <li><strong>Per-IP rate limit</strong> — token bucket per category (public/verify/admin/authFail).</li>
          <li><strong>Bearer authentication</strong> — constant-time comparison against a SHA-256 hash.</li>
          <li><strong>Per-keyId rate limit</strong> — second dimension on top of per-IP.</li>
          <li><strong>Body + claims caps</strong> — both byte cap and structural shape cap.</li>
          <li><strong>Writer-lock fence verification</strong> — confirms we still own this DATA_DIR.</li>
          <li><strong>MutationChain advance</strong> — atomic increment + SHA3 ratchet.</li>
          <li><strong>Token construction</strong> — header + AEAD-sealed claims + signature.</li>
          <li><strong>Chain-log durable append</strong> — fsync before responding.</li>
          <li><strong>Audit event</strong> — JSONL with W3C traceparent.</li>
          <li><strong>Prometheus counter</strong> — bumped per outcome.</li>
          <li><strong>Response</strong> — JSON envelope with the hex token.</li>
        </ol>

        <h2>Observability</h2>
        <p>
          <strong>Prometheus</strong> at <code>/v3/metrics</code> emits
          per-route counters, latency histograms, queue depths, and
          per-key denial counts. <strong>Audit log</strong> is JSONL, one
          event per line, every event tagged with the W3C{' '}
          <code>traceparent</code>. <strong>OTLP</strong> (optional) ships
          the same audit stream via HTTP/JSON to your collector. The
          forensic CLI <code>qv-audit</code> filters and summarises the
          stream without jq pipelines.
        </p>

        <h2>Lifecycle</h2>
        <p>
          The server distinguishes liveness (is the process up?) from
          readiness (is the keystore loaded, the writer lock acquired,
          the chain verified?). Kubernetes probes target the right one.
          Graceful shutdown drains in-flight requests, releases the
          writer lock, and exits with code 0.
        </p>

        <h2>Supply-chain</h2>
        <p>
          <strong>Zero npm dependencies in the server.</strong> A CI gate
          rejects any commit that ships a non-empty{' '}
          <code>dependencies</code> field or a stale{' '}
          <code>package-lock.json</code>. The Docker base is pinned by
          digest as well as tag — a registry compromise that swaps a tag
          cannot affect deployed builds. Released images are signed with
          Sigstore cosign (keyless OIDC) and ship with a CycloneDX 1.5
          SBOM as an OCI attestation.
        </p>

        <h2>Operating modes</h2>
        <p>
          <strong>Single-writer.</strong> One server per <code>DATA_DIR</code>.
          The writer-lock fence prevents accidental dual-writers on the
          same host or shared filesystem. Verify replicas can be added
          for read scale.
        </p>
        <p>
          <strong>Multi-writer (v4.3+).</strong> Set{' '}
          <code>QV_CHAIN_STORE=postgres</code> and point at a Postgres
          database. The PRIMARY KEY constraint on{' '}
          <code>(key_id, counter)</code> enforces correctness across N
          writers — the loser of any race surfaces as{' '}
          <code>CHAIN_LOG_CONFLICT</code>. No coordinator process, no
          advisory locks.
        </p>

        <h2>Where to read more</h2>
        <ul>
          <li>
            <a href="https://github.com/007krcs/quantum-vault/tree/main/docs/story" target="_blank" rel="noreferrer">Storybook</a>{' '}
            — 22 chapters, one per architectural decision, with the
            why and the how.
          </li>
          <li>
            <a href="https://github.com/007krcs/quantum-vault/tree/main/qv-spec" target="_blank" rel="noreferrer">Specification</a>{' '}
            — OpenAPI 3.1, wire format, error code registry, conformance
            test vectors. CC BY 4.0.
          </li>
          <li>
            <Link to="/concepts">How it works</Link> — the cryptographic
            spine in five ideas.
          </li>
          <li>
            <Link to="/quickstart">Quickstart</Link> — run it on your
            laptop in 60 seconds.
          </li>
        </ul>
      </div>
    </div>
  );
}
