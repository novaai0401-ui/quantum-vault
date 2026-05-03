// SPDX-License-Identifier: Apache-2.0
import { Link } from 'react-router-dom';

export default function Concepts() {
  return (
    <div className="page">
      <div className="container-narrow">
        <div className="section-eyebrow">How it works</div>
        <h1>The cryptographic spine of Sigvault.</h1>
        <p className="section-lead">
          Five ideas, in order. Read them once and the rest of the
          architecture follows from them.
        </p>

        <h2>The key triplet</h2>
        <p>
          Every Sigvault identity carries three keys: a <strong>signing
          key</strong> (ML-DSA-87 or Falcon), an <strong>encrypt key</strong>{' '}
          (XChaCha20-Poly1305), and a <strong>mutation seed</strong>. The
          signing key proves the issuer's identity. The encrypt key seals
          the claims so only an authorised verifier can read them. The
          mutation seed anchors a per-key cryptographic chain that makes
          replay impossible. All three rotate together when a key is
          revoked; nothing leaks across keys.
        </p>

        <h2>The token wire format</h2>
        <p>
          A Sigvault token is a fixed-layout binary structure:
        </p>
        <pre><code>{`offset  size  field
─────── ────  ──────────────────────────
   0      4   MAGIC          0x51 56 4C 54
   4      2   VERSION        0x03 0x00
   6      1   suite          (registry)
   7      1   tokenType      (registry)
   8      8   issuedAt       µs since epoch
  16      4   ttl            seconds
  20     32   nonce
  52     32   deviceFp
  84      4   plLen
  88   plLen  encPayload     XChaCha20-Poly1305(claims)
88+plLen  8   mutationCtr
96+plLen  N   signature      ML-DSA-87 or Falcon`}</code></pre>
        <p>
          The signature covers everything before itself. The encrypted
          payload protects the claims at rest and in transit. The
          mutation counter is the load-bearing replay-protection field —
          a verifier rejects any token whose counter is ≤ the chain's
          last-seen counter for that keyId.
        </p>

        <h2>The MutationChain</h2>
        <p>
          For every key, the server maintains a hash chain:
        </p>
        <pre><code>{`state₀     = encryptKey[..32]
state_n    = SHA3-256(state_{n-1} || ctr_{n-1}_be64)
ctr_n      = ctr_{n-1} + 1`}</code></pre>
        <p>
          Each issued token carries the post-advance counter in its
          binary header. On verify, the server confirms{' '}
          <code>token.ctr &gt; chain.ctr</code> and advances. A replay attempt
          fails because <code>token.ctr ≤ chain.ctr</code>. Importantly, the
          chain log on disk records every <code>(ctr, stateHash)</code> pair so
          that on restart the server can re-derive every state from the
          seed and verify cryptographic linkage. Tampering between
          restarts surfaces as <code>CHAIN_LOG_TAMPERED</code> and the server
          refuses to start.
        </p>

        <h2>Multi-writer correctness</h2>
        <p>
          When you scale horizontally with the Postgres ChainStore, the
          load-bearing constraint is one line of SQL:
        </p>
        <pre><code>{`PRIMARY KEY (key_id, counter)`}</code></pre>
        <p>
          Two writers racing to advance the same chain to the same
          counter both attempt an INSERT. The database accepts exactly
          one. The loser sees <code>23505 unique_violation</code> and the
          ChainStore translates it to <code>CHAIN_LOG_CONFLICT</code> — the
          loser refreshes its view of the chain and retries. No
          coordinator. No advisory lock. No split-brain. The constraint
          is the coordinator.
        </p>

        <h2>Sealing keys at rest</h2>
        <p>
          The keystore on disk holds every signing and encrypt key sealed
          under a master key with AES-256-GCM, and the keyId as
          additional authenticated data. Swapping a sealed key from
          another keyId fails AEAD verification — you cannot rebind a
          signing key to a different identity by editing the keystore.
          Master rotation is a single command (<code>rotate-master.mjs</code>)
          that re-seals every entry under a new master and atomically
          swaps both files.
        </p>

        <h2>Why all this matters</h2>
        <p>
          Each layer eliminates a vulnerability that has shipped in
          production identity systems. Together they take the major
          classes of token compromise off the table by construction:
        </p>
        <ul>
          <li><strong>Quantum break</strong> — ML-DSA-87 is FIPS 204; not factoring or discrete-log.</li>
          <li><strong>Replay</strong> — the chain counter is monotonic and verified at every step.</li>
          <li><strong>Claims leak</strong> — XChaCha20-Poly1305 with per-token nonces.</li>
          <li><strong>Key swap</strong> — keyId is the AAD; rebinding fails AEAD.</li>
          <li><strong>Silent corruption</strong> — chain-log linkage verified at boot.</li>
          <li><strong>Hyperscaler hijack of OSS</strong> — AGPL-3.0.</li>
          <li><strong>Supply-chain compromise</strong> — zero npm runtime deps in the server.</li>
        </ul>

        <p style={{ marginTop: 36 }}>
          Continue with <Link to="/architecture">Architecture</Link> for
          how the request flows through the server end-to-end, or jump
          to the full <a href="https://github.com/007krcs/quantum-vault/tree/main/docs/story" target="_blank" rel="noreferrer">storybook</a> for
          the chapter-by-chapter rationale.
        </p>
      </div>
    </div>
  );
}
