import { TkxAlert, TkxBadge, TkxCard, TkxCardBody } from 'tekivex-ui';

export default function Concepts() {
  return (
    <>
      <h1>Concepts &amp; Glossary</h1>
      <p className="lead">
        Sigvault borrows vocabulary from JWT, PASETO, NIST, and the
        PQClean project. This page is the one place where every term is
        defined, every three-letter acronym is spelled out, and every
        "what's the difference between X and Y?" question is answered.
        If you're new to post-quantum crypto, read top to bottom. If
        you're debugging a wire dump, jump to{' '}
        <a href="#token-anatomy">Token anatomy</a>.
      </p>

      {/* ============================================================ */}
      <h2 id="pqc-101">1. Post-quantum crypto in 90 seconds</h2>

      <p>
        Today's mainstream signature algorithms — RSA, ECDSA
        (secp256k1, P-256), Ed25519 — all rely on problems that a
        sufficiently large <strong>quantum computer</strong> running{' '}
        <em>Shor's algorithm</em> can solve in polynomial time. The
        moment such a machine exists, every JWT, every TLS certificate,
        every signed software release becomes forgeable.
      </p>
      <p>
        <strong>Post-quantum cryptography (PQC)</strong> replaces those
        primitives with ones whose hardness rests on lattice problems,
        hash trees, or multivariate polynomials — problems for which no
        efficient quantum algorithm is known. In August 2024, NIST
        standardized the first three PQC signature schemes:
      </p>

      <table>
        <thead>
          <tr>
            <th>NIST name</th>
            <th>Old name</th>
            <th>Family</th>
            <th>Standard</th>
          </tr>
        </thead>
        <tbody>
          <tr><td><strong>ML-DSA</strong></td><td>CRYSTALS-Dilithium</td><td>Lattice (module-LWE)</td><td>FIPS 204</td></tr>
          <tr><td><strong>SLH-DSA</strong></td><td>SPHINCS+</td><td>Hash-based</td><td>FIPS 205</td></tr>
          <tr><td><strong>FN-DSA</strong></td><td>Falcon</td><td>Lattice (NTRU)</td><td>FIPS 206 (draft)</td></tr>
        </tbody>
      </table>

      <p>
        Sigvault implements <strong>ML-DSA-87</strong> (highest
        security level of Dilithium) as its default, and adds{' '}
        <strong>Falcon-512 / Falcon-1024</strong> as opt-in suites for
        when signature size matters.
      </p>

      {/* ============================================================ */}
      <h2 id="ml-dsa-vs-falcon">2. ML-DSA vs Falcon — which do I pick?</h2>

      <div className="qv-grid two">
        <TkxCard variant="outline">
          <TkxCardBody>
            <h3 style={{ marginTop: 0 }}>
              ML-DSA-87 <TkxBadge size="sm" colorScheme="primary">default</TkxBadge>
            </h3>
            <ul>
              <li><strong>Signature:</strong> 4 627 bytes</li>
              <li><strong>Public key:</strong> 2 592 bytes</li>
              <li><strong>Speed:</strong> fast sign, fast verify</li>
              <li><strong>Security:</strong> NIST category 5 (highest)</li>
              <li><strong>Implementation:</strong> pure Rust — no C toolchain</li>
              <li><strong>Side-channels:</strong> constant-time by construction</li>
            </ul>
            <p>
              Pick ML-DSA-87 when: wire size doesn't matter, you want
              the default NIST-standardized path, you're running on
              wasm32 (no C compiler), or you need maximum portability.
            </p>
          </TkxCardBody>
        </TkxCard>

        <TkxCard variant="outline">
          <TkxCardBody>
            <h3 style={{ marginTop: 0 }}>
              Falcon-512 <TkxBadge size="sm" variant="outline">compact</TkxBadge>
            </h3>
            <ul>
              <li><strong>Signature:</strong> 666 bytes (7.1× smaller)</li>
              <li><strong>Public key:</strong> 897 bytes</li>
              <li><strong>Speed:</strong> slower sign, 6× faster verify</li>
              <li><strong>Security:</strong> NIST category 1</li>
              <li><strong>Implementation:</strong> PQClean C reference — needs <code>cc</code></li>
              <li><strong>Side-channels:</strong> requires careful FP sampling (we use PQClean's constant-time path)</li>
            </ul>
            <p>
              Pick Falcon-512 when: bandwidth is expensive (IoT,
              mobile, cold wallets), verify throughput matters more
              than sign throughput, or you want shorter tokens.
              Falcon-1024 is the category-5 variant (1 280 B sigs).
            </p>
          </TkxCardBody>
        </TkxCard>
      </div>

      <TkxAlert variant="info" title="Both are quantum-safe.">
        This isn't a security trade-off — it's an engineering one.
        ML-DSA and Falcon are both believed to resist attacks from
        Shor, Grover, and every known quantum algorithm. The decision
        is bytes-on-the-wire vs build-system simplicity.
      </TkxAlert>

      {/* ============================================================ */}
      <h2 id="why-not-jwt">3. Why not just use JWT?</h2>

      <p>
        JWT (RFC 7519) is a <em>container</em>, not an algorithm. Its
        security depends entirely on which signing algorithm you put
        inside the <code>alg</code> header. Today that's almost always
        RS256 (RSA), ES256 (ECDSA P-256), or EdDSA (Ed25519) — all of
        which Shor breaks. There is no registered JOSE <code>alg</code>{' '}
        value for ML-DSA or Falcon as of April 2026, so a "JWT with
        ML-DSA" would be a non-standard extension only your libraries
        would honor.
      </p>
      <p>
        Sigvault's wire format is deliberately <em>not</em> JWT.
        We take the useful parts (typed claims, expiry, opaque
        key-id), drop the footguns (algorithm confusion,{' '}
        <code>alg: none</code>, base64url header parsing), and add
        things JWT doesn't have:
      </p>

      <table>
        <thead>
          <tr><th>Feature</th><th>JWT</th><th>Sigvault</th></tr>
        </thead>
        <tbody>
          <tr><td>Post-quantum signature</td><td>❌</td><td>✅ ML-DSA-87 / Falcon</td></tr>
          <tr><td>Claims encrypted at rest</td><td>❌ (base64, not encryption)</td><td>✅ XChaCha20-Poly1305 AEAD</td></tr>
          <tr><td>Replay protection</td><td>via <code>jti</code> + server state</td><td>✅ MutationChain counter</td></tr>
          <tr><td>Algorithm confusion possible</td><td>⚠️ famous class of CVEs</td><td>❌ suite is byte-typed</td></tr>
          <tr><td>Device-binding</td><td>ad-hoc claim</td><td>✅ <code>device_fp</code> in header</td></tr>
          <tr><td>Variable-length signature support</td><td>n/a</td><td>✅ (Falcon is variable)</td></tr>
        </tbody>
      </table>

      <p>
        PASETO (v4) is closer in spirit but still ships Ed25519 as its
        only asymmetric option. Sigvault is what you want if
        "quantum-safe" is a hard requirement.
      </p>

      {/* ============================================================ */}
      <h2 id="token-anatomy">4. Token anatomy — every byte, explained</h2>

      <p>A Sigvault raw token on the wire looks like this:</p>

      <pre><code>{`┌────────────────────── HEADER (fixed 107 B) ──────────────────────┐
│ suite:1  type:1  issued_at:8  ttl:4                              │
│ nonce:32  device_fp:32  mutation_ctr:8  payload_len:4  enc_hdr:17│
├────────────── ENCRYPTED PAYLOAD (variable, AEAD) ────────────────┤
│ XChaCha20-Poly1305(plaintext = CBOR(claims), key = encrypt_key,  │
│                    nonce = header.nonce)  →  ciphertext || tag   │
├──────────────────── SIGNATURE (suite-sized) ─────────────────────┤
│ sign(signing_key, header || encrypted_payload)                   │
│   ML-DSA-87:  4 627 B (fixed)                                    │
│   Falcon-512:   ≤666 B (variable, length-prefixed)               │
│   Falcon-1024:  ≤1280 B (variable, length-prefixed)              │
└──────────────────────────────────────────────────────────────────┘`}</code></pre>

      <p>The wire bytes are then hex-encoded for transport in HTTP headers, cookies, or JSON.</p>

      <h3>Each field, what it means</h3>
      <dl>
        <dt><code>suite</code> (1 byte)</dt>
        <dd>
          See <a href="#suites">SuiteId</a>. Identifies which signature
          algorithm was used — verifiers dispatch on this. Having it
          be a <em>byte</em>, not a JSON string, is why algorithm
          confusion attacks don't apply.
        </dd>

        <dt><code>type</code> (1 byte)</dt>
        <dd>
          See <a href="#token-type">TokenType</a>. <code>0x01</code>{' '}
          = access, <code>0x02</code> = refresh, <code>0x03</code> =
          consent, <code>0x04</code> = session. Changes which claims
          your server should trust.
        </dd>

        <dt><code>issued_at</code> (u64 µs since UNIX epoch)</dt>
        <dd>
          Microseconds, not seconds — this matters for replay windows
          in sub-second auth flows. Set by the issuer at
          signing time from <code>SystemTime::now()</code>.
        </dd>

        <dt><code>ttl</code> (u32 seconds)</dt>
        <dd>Seconds after <code>issued_at</code> past which the token is rejected.</dd>

        <dt><code>nonce</code> (32 B random)</dt>
        <dd>
          Dual-purpose: (a) AEAD nonce for XChaCha20-Poly1305 — XChaCha
          needs 24 B, we use the first 24, the other 8 enter the
          entropy-certification check; (b) input to{' '}
          <code>device_fp</code> when caller doesn't supply one.
          Drawn from the OS CSPRNG (<code>getrandom</code>).
        </dd>

        <dt><code>device_fp</code> (32 B SHA3-256)</dt>
        <dd>
          Opaque fingerprint of the issuing device / session. Default
          is <code>SHA3-256(nonce)</code>, but callers can bind to
          hardware TPM attestation, a browser-fingerprint hash, a TLS
          client cert thumbprint, etc. Verifiers can require a match.
        </dd>

        <dt><code>mutation_ctr</code> (u64)</dt>
        <dd>
          The chain counter <em>after</em> this token was issued. The
          verifier keeps its own <a href="#mutation-chain">MutationChain</a>{' '}
          and rejects tokens whose counter isn't strictly greater than
          what it has seen — that's replay protection without a
          server-side JTI store.
        </dd>

        <dt><code>encrypted_payload</code></dt>
        <dd>
          CBOR-serialized <a href="#claims">Claims</a> map, encrypted
          with XChaCha20-Poly1305 using <code>encrypt_key</code> and{' '}
          <code>nonce</code>. Confidentiality + integrity against
          anyone without <code>encrypt_key</code>, even if they have
          the verifying key.
        </dd>

        <dt><code>signature</code></dt>
        <dd>
          Post-quantum signature over <code>header || encrypted_payload</code>.
          Size and algorithm depend on <code>suite</code>.
        </dd>
      </dl>

      {/* ============================================================ */}
      <h2 id="suites">5. SuiteId — the 1-byte algorithm tag</h2>

      <table>
        <thead>
          <tr>
            <th>SuiteId</th>
            <th>Byte</th>
            <th>Algorithm</th>
            <th>Sig size</th>
            <th>Use case</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>Dilithium5</code></td>
            <td><code>0x05</code></td>
            <td>ML-DSA-87</td>
            <td>4 627 B</td>
            <td>Default — every client ships with this path</td>
          </tr>
          <tr>
            <td><code>Dual</code></td>
            <td><code>0x09</code></td>
            <td>ML-DSA-87 <em>and</em> Ed25519 (reserved)</td>
            <td>4 691 B</td>
            <td>Transitional hybrid for migration periods</td>
          </tr>
          <tr>
            <td><code>Falcon512</code></td>
            <td><code>0x10</code></td>
            <td>Falcon-512</td>
            <td>≤666 B</td>
            <td>Bandwidth-constrained, verify-heavy workloads</td>
          </tr>
          <tr>
            <td><code>Falcon1024</code></td>
            <td><code>0x11</code></td>
            <td>Falcon-1024</td>
            <td>≤1 280 B</td>
            <td>Same, but at NIST category 5</td>
          </tr>
          <tr>
            <td><code>Triple</code></td>
            <td><code>0xFF</code></td>
            <td>ML-DSA + Falcon + Ed25519</td>
            <td>~6 KB</td>
            <td>Belt-and-suspenders for root-of-trust signing</td>
          </tr>
        </tbody>
      </table>

      <TkxAlert variant="info" title="Variable vs fixed sig sizes.">
        ML-DSA sigs are always the same length. Falcon sigs are
        <em> variable</em> (the sampler rejects occasionally). On the
        wire, Falcon sigs are length-prefixed so the parser knows
        where the signature ends. <code>SuiteId::sig_is_variable_length()</code>{' '}
        tells you which regime you're in.
      </TkxAlert>

      {/* ============================================================ */}
      <h2 id="token-type">6. TokenType — the semantics byte</h2>

      <p>
        Same shape as OAuth 2.0 token types, but enforced at the
        signature layer instead of via a separate <code>typ</code>{' '}
        claim.
      </p>

      <table>
        <thead>
          <tr><th>Variant</th><th>Byte</th><th>Typical TTL</th><th>Use</th></tr>
        </thead>
        <tbody>
          <tr><td><code>Access</code></td><td><code>0x01</code></td><td>5 – 60 min</td><td>Short-lived, carries authorization claims, sent with every request.</td></tr>
          <tr><td><code>Refresh</code></td><td><code>0x02</code></td><td>7 – 90 days</td><td>Exchanged at <code>/token/refresh</code> for a new access token. Rotate on use.</td></tr>
          <tr><td><code>Consent</code></td><td><code>0x03</code></td><td>minutes</td><td>Records a user approval for a specific scope + audience.</td></tr>
          <tr><td><code>Session</code></td><td><code>0x04</code></td><td>hours</td><td>Browser session cookie contents; often device-fp-bound.</td></tr>
        </tbody>
      </table>

      {/* ============================================================ */}
      <h2 id="mutation-chain">7. MutationChain — replay protection without a JTI store</h2>

      <p>
        A <strong>MutationChain</strong> is a 32-byte <em>state</em>{' '}
        plus a 64-bit <em>counter</em>. Each time a token is issued,
        the chain advances:
      </p>

      <pre><code>{`state' = SHA3-256(state || counter || issuer_entropy)
counter' = counter + 1`}</code></pre>

      <p>
        The counter is embedded in the token's{' '}
        <code>mutation_ctr</code> field. Verifiers keep their own
        chain and only accept a token whose counter is{' '}
        <em>strictly greater</em> than the highest counter they've
        previously accepted from that issuer. Attempting to replay an
        old token is rejected without needing a database of seen JTIs.
      </p>
      <p>
        You will see two forms in the Rust API:
      </p>
      <ul>
        <li><code>MutationChain::new(seed)</code> — issuer side, starts at counter 0.</li>
        <li><code>MutationChain::from_state(state, counter)</code> — verifier side, resumes from a snapshot.</li>
      </ul>
      <p>
        In JS: <code>new MutationChain()</code> for issuer,{' '}
        <code>new MutationChain(existingState)</code> for verifier.
        The <code>chain.state</code> getter returns a serializable
        snapshot you can persist.
      </p>

      {/* ============================================================ */}
      <h2 id="keys">8. Three keys, three jobs</h2>

      <p>
        Every Sigvault identity has <em>three</em> keys, not one.
        Mixing them up is the #1 cause of "why doesn't this verify?"
        bug reports.
      </p>

      <div className="qv-grid two">
        <TkxCard variant="outline">
          <TkxCardBody>
            <h3 style={{ marginTop: 0 }}><code>signingKey</code></h3>
            <p>
              The <strong>private</strong> half of the PQ signature
              keypair. Lives only on the issuer. ML-DSA-87 seed = 32 B;
              Falcon seeds differ. Never ships across the wire.
            </p>
          </TkxCardBody>
        </TkxCard>
        <TkxCard variant="outline">
          <TkxCardBody>
            <h3 style={{ marginTop: 0 }}><code>verifyingKey</code></h3>
            <p>
              The <strong>public</strong> half. Distribute freely — to
              clients, to microservices, to a JWKS-equivalent endpoint.
              Used to check the signature on a token.
            </p>
          </TkxCardBody>
        </TkxCard>
        <TkxCard variant="outline">
          <TkxCardBody>
            <h3 style={{ marginTop: 0 }}><code>encryptKey</code></h3>
            <p>
              A <strong>symmetric</strong> 32-byte key for
              XChaCha20-Poly1305 AEAD. Both issuer and verifier need
              it — it encrypts the payload. Keep it secret from
              anyone who should not read claims.
            </p>
          </TkxCardBody>
        </TkxCard>
        <TkxCard variant="outline">
          <TkxCardBody>
            <h3 style={{ marginTop: 0 }}>Relationship</h3>
            <p>
              Signing ↔ verifying is an <em>asymmetric</em> pair
              (generated together). <code>encryptKey</code> is{' '}
              <em>independent</em> — you can rotate it without touching
              the PQ keys, and vice-versa.
            </p>
          </TkxCardBody>
        </TkxCard>
      </div>

      {/* ============================================================ */}
      <h2 id="claims">9. Claims — what goes inside</h2>
      <p>
        A Sigvault claims bag is a <strong>CBOR map of string → value</strong>.
        There are no reserved claim names (unlike JWT's{' '}
        <code>iss</code>, <code>sub</code>, <code>aud</code>…), but by
        convention we use the JWT names because tooling is universal.
      </p>
      <pre><code>{`{
  "sub":   "user-123",        // subject — who the token is about
  "role":  "admin",           // application-specific
  "aud":   "api.example.com", // audience — who should accept it
  "scope": ["read", "write"],
}`}</code></pre>
      <p>
        Claims are CBOR-encoded then encrypted — so they're invisible
        to anyone without <code>encryptKey</code>, even if they can
        see the raw wire bytes.
      </p>

      {/* ============================================================ */}
      <h2 id="entropy-cert">10. Entropy certification</h2>
      <p>
        Before a nonce is used, Sigvault runs{' '}
        <code>certify_entropy(nonce)</code> — a sanity check that the
        32 bytes aren't all-zero, aren't a repeated pattern, and pass
        a shannon-entropy threshold. This catches catastrophic RNG
        failures (think debug builds that hard-code zeroes, or WASM
        runtimes where <code>getrandom</code> was never wired). If
        certification fails, issuance aborts before anything hits the
        wire.
      </p>

      {/* ============================================================ */}
      <h2 id="packages">11. Which package should I use?</h2>

      <table>
        <thead>
          <tr>
            <th>Package</th>
            <th>Registry</th>
            <th>For</th>
            <th>Needs server?</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>qv-core</code></td>
            <td>crates.io</td>
            <td>Rust backends — issue/verify inline with no network hop</td>
            <td>No</td>
          </tr>
          <tr>
            <td><code>@sigvault/sdk</code></td>
            <td>npm</td>
            <td>Node / Deno / Bun / Workers — pure JS, no WASM</td>
            <td>No</td>
          </tr>
          <tr>
            <td><code>@sigvault/wasm</code></td>
            <td>npm</td>
            <td>Browsers + edge runtimes where bundle size matters (≈48 KB gzipped)</td>
            <td>No</td>
          </tr>
          <tr>
            <td><code>sigvault</code> (PyPI)</td>
            <td>PyPI</td>
            <td>Python — stdlib REST client</td>
            <td><strong>Yes</strong> — talks to qv-server</td>
          </tr>
          <tr>
            <td><code>libqv</code> (FFI)</td>
            <td>GitHub Releases</td>
            <td>C / Go / C# / Swift / Java — native speed via ctypes/cgo/P-Invoke/JNI</td>
            <td>No</td>
          </tr>
          <tr>
            <td><code>qv-server</code></td>
            <td>GHCR (Docker)</td>
            <td>Any language — HTTP REST on port 7433, zero npm deps</td>
            <td>itself <em>is</em> the server</td>
          </tr>
        </tbody>
      </table>

      <TkxAlert variant="info" title="Decision heuristic.">
        <strong>Same process as your app?</strong> Use qv-core /
        @sigvault/sdk / libqv — fastest, no network.
        <br/>
        <strong>Polyglot shop, Python/PHP/Ruby included?</strong> Run
        qv-server and have every language hit the REST API.
        <br/>
        <strong>Browser / edge?</strong> @sigvault/wasm.
      </TkxAlert>

      {/* ============================================================ */}
      <h2 id="common-errors">12. Common error codes</h2>
      <table>
        <thead>
          <tr><th>Error</th><th>What it means</th><th>Typical cause</th></tr>
        </thead>
        <tbody>
          <tr><td><code>UnknownSuite(0x??)</code></td><td>Verifier can't dispatch this byte</td><td>Falcon token sent to ML-DSA-only build</td></tr>
          <tr><td><code>BAD_SIGNATURE</code></td><td>PQ sig didn't verify</td><td>Wrong verifying key, tampered token, or suite mismatch</td></tr>
          <tr><td><code>EXPIRED</code></td><td><code>issued_at + ttl &lt; now</code></td><td>Clock skew or legitimately expired</td></tr>
          <tr><td><code>REPLAY_DETECTED</code></td><td>mutation_ctr ≤ verifier's last seen</td><td>Replay, or verifier state out of sync</td></tr>
          <tr><td><code>AEAD_DECRYPT_FAIL</code></td><td>Payload MAC didn't check out</td><td>Wrong <code>encrypt_key</code> or bit-flipped ciphertext</td></tr>
          <tr><td><code>ENTROPY_CERT_FAIL</code></td><td>Nonce failed the sanity suite</td><td>RNG not wired on wasm32, or debug stub</td></tr>
          <tr><td><code>REVOKED</code></td><td>keyId in the revocation list</td><td>Intentional rotation / incident response</td></tr>
        </tbody>
      </table>

      {/* ============================================================ */}
      <h2 id="vocab">13. Vocabulary quick-reference</h2>
      <dl>
        <dt>AEAD</dt><dd>Authenticated Encryption with Associated Data. A cipher that both encrypts and carries a MAC. We use XChaCha20-Poly1305.</dd>
        <dt>BLS / RSA / ECDSA</dt><dd>Classical signature algorithms — <em>not</em> quantum-safe. Sigvault does not implement them.</dd>
        <dt>CBOR</dt><dd>Concise Binary Object Representation (RFC 8949). A schema-less binary format — like JSON, but smaller and faster to parse. Used for claims.</dd>
        <dt>CSPRNG</dt><dd>Cryptographically Secure PRNG. OS-provided on native platforms; on WASM we require a host import.</dd>
        <dt>Dilithium</dt><dd>Former name of ML-DSA. "Dilithium5" still appears in our API for historical continuity.</dd>
        <dt>Falcon</dt><dd>Fast-Fourier Lattice-based Compact signature scheme. Becoming FN-DSA under FIPS 206.</dd>
        <dt>FIPS 204 / 205 / 206</dt><dd>NIST publications standardizing ML-DSA, SLH-DSA, and FN-DSA respectively.</dd>
        <dt>JOSE / JWT / JWS / JWE</dt><dd>Classical token / crypto suite from IETF. Sigvault is deliberately not JOSE-compatible — see §3.</dd>
        <dt>JWKS</dt><dd>JSON Web Key Set — a discovery endpoint listing public keys. Sigvault's equivalent is <code>GET /v3/keys</code>.</dd>
        <dt>KEM</dt><dd>Key Encapsulation Mechanism. ML-KEM (Kyber) is the KEM counterpart to ML-DSA. Sigvault pulls it in transitively for future hybrid modes; not exposed in the v4.2 public API.</dd>
        <dt>ML-DSA-87</dt><dd>The category-5 parameter set of ML-DSA. The "87" is historical — it's not a bit-size, it's a variant label.</dd>
        <dt>NIST category 1 / 3 / 5</dt><dd>Rough security-equivalence buckets: 1 ≈ AES-128, 3 ≈ AES-192, 5 ≈ AES-256.</dd>
        <dt>PQC</dt><dd>Post-Quantum Cryptography.</dd>
        <dt>PQClean</dt><dd>Community-maintained reference implementation corpus — we vendor the Falcon code from it.</dd>
        <dt>Shor's algorithm</dt><dd>Quantum algorithm that factors integers and solves discrete log in polynomial time — the reason RSA/ECDSA/Ed25519 need replacing.</dd>
        <dt>SHA3-256</dt><dd>Keccak-based hash, FIPS 202. Used for entropy certification and device fingerprinting.</dd>
        <dt>Suite</dt><dd>Sigvault's 1-byte algorithm tag. See §5.</dd>
        <dt>XChaCha20-Poly1305</dt><dd>Extended-nonce (24 B) ChaCha20 stream cipher with Poly1305 MAC. AEAD construction used to encrypt claims.</dd>
      </dl>
    </>
  );
}
