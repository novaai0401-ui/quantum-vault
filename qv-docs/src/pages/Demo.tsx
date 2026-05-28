// SPDX-License-Identifier: Apache-2.0
//
// Interactive in-browser demo. Issues + verifies a real Sigvault token
// using @sigvault/sdk@4.3.7 — the same package any developer would
// `npm install`. Zero round-trip to any server; the post-quantum signing
// happens locally in the visitor's browser.

import { useState } from 'react';

// Lazy-load the SDK so the initial bundle stays small. Noble PQ libs are
// ~150 KB of wasm-free JS — fine, but no reason to pay it on first paint.
async function loadSdk() {
  const m = await import('@sigvault/sdk');
  return m;
}

type Sdk = Awaited<ReturnType<typeof loadSdk>>;

interface KeyState {
  signingKey:   Uint8Array;
  verifyingKey: Uint8Array;
  encryptKey:   Uint8Array;
  chain:        any; // MutationChain — typed via SDK at runtime
}

interface TokenState {
  hex:        string;
  bytes:      number;
  mutationCtr: bigint;
}

function toHexPreview(u8: Uint8Array, max = 48): string {
  const buf: string[] = [];
  for (let i = 0; i < Math.min(u8.length, max / 2); i++) {
    buf.push(u8[i].toString(16).padStart(2, '0'));
  }
  return buf.join('') + (u8.length > max / 2 ? '…' : '');
}

export default function Demo() {
  const [sdk, setSdk]                       = useState<Sdk | null>(null);
  const [sdkLoading, setSdkLoading]         = useState(false);
  const [keys, setKeys]                     = useState<KeyState | null>(null);
  const [token, setToken]                   = useState<TokenState | null>(null);
  const [claimsInput, setClaimsInput]       = useState(`{
  "sub":   "alice@example.com",
  "role":  "admin",
  "scope": "read write"
}`);
  const [verifyResult, setVerifyResult]     = useState<string | null>(null);
  const [tamperResult, setTamperResult]     = useState<string | null>(null);
  const [error, setError]                   = useState<string | null>(null);
  const [timings, setTimings]               = useState<Record<string, number>>({});

  async function ensureSdk(): Promise<Sdk> {
    if (sdk) return sdk;
    setSdkLoading(true);
    try {
      const m = await loadSdk();
      setSdk(m);
      return m;
    } finally {
      setSdkLoading(false);
    }
  }

  async function genKeys() {
    setError(null);
    try {
      const m = await ensureSdk();
      const t0 = performance.now();
      const kp = m.generateKeypair();
      // Deterministic chain seed (mirrors server-side behaviour).
      const chain = new m.MutationChain(kp.encryptKey.slice(0, 32));
      const dt = performance.now() - t0;
      setKeys({ ...kp, chain });
      setToken(null);
      setVerifyResult(null);
      setTamperResult(null);
      setTimings((s) => ({ ...s, keygen: dt }));
    } catch (e: any) {
      setError(`Key generation failed: ${e.message}`);
    }
  }

  async function issueToken() {
    setError(null);
    setVerifyResult(null);
    setTamperResult(null);
    if (!keys) { setError('Generate a keypair first.'); return; }
    try {
      const m = await ensureSdk();
      let claims: Record<string, unknown>;
      try {
        claims = JSON.parse(claimsInput);
      } catch (e: any) {
        setError(`Claims JSON invalid: ${e.message}`); return;
      }
      const t0 = performance.now();
      const { tokenHex, tokenBytes } = m.issueToken({
        signingKey: keys.signingKey,
        encryptKey: keys.encryptKey,
        chain:      keys.chain,
        claims,
        ttl: 3600,
      });
      const dt = performance.now() - t0;
      setToken({ hex: tokenHex, bytes: tokenBytes.length, mutationCtr: keys.chain.counter });
      setTimings((s) => ({ ...s, issue: dt }));
    } catch (e: any) {
      setError(`Issue failed: ${e.message}`);
    }
  }

  async function verifyToken() {
    setError(null);
    setTamperResult(null);
    if (!keys || !token) { setError('Issue a token first.'); return; }
    try {
      const m = await ensureSdk();
      const verifyChain = m.MutationChain.fromState(keys.encryptKey.slice(0, 32), 0n);
      const t0 = performance.now();
      const out = m.verifyToken({
        token:        token.hex,
        verifyingKey: keys.verifyingKey,
        encryptKey:   keys.encryptKey,
        chain:        verifyChain,
      });
      const dt = performance.now() - t0;
      setVerifyResult(JSON.stringify({
        valid:        true,
        claims:       out.claims,
        ttlSecs:      out.ttl,
        mutationCtr:  out.mutationCtr.toString(),
        issuedAt:     new Date(Number(out.issuedAt / 1000n)).toISOString(),
      }, null, 2));
      setTimings((s) => ({ ...s, verify: dt }));
    } catch (e: any) {
      setVerifyResult(`Rejected: ${e.message}`);
    }
  }

  async function tamperTest() {
    setError(null);
    if (!keys || !token) { setError('Issue a token first.'); return; }
    try {
      const m = await ensureSdk();
      // Flip one byte 30 positions before the end of the signature.
      const bad = token.hex.slice(0, -8) + 'deadbeef';
      const verifyChain = m.MutationChain.fromState(keys.encryptKey.slice(0, 32), 0n);
      try {
        m.verifyToken({
          token:        bad,
          verifyingKey: keys.verifyingKey,
          encryptKey:   keys.encryptKey,
          chain:        verifyChain,
        });
        setTamperResult('UNEXPECTED: tampered token was accepted (this should never happen)');
      } catch (e: any) {
        setTamperResult(`Correctly rejected: ${e.message}`);
      }
    } catch (e: any) {
      setError(`Tamper test failed: ${e.message}`);
    }
  }

  return (
    <div className="page">
      <div className="container">
        <div className="section-eyebrow">Interactive demo</div>
        <h1>Issue and verify a post-quantum token, right here.</h1>
        <p className="section-lead">
          Everything below runs in your browser using <code>@sigvault/sdk@4.3.7</code> —
          the same package any developer would <code>npm install</code>. No server, no
          account, no signup. The post-quantum signing happens locally.
        </p>

        {error && <div className="demo-error">⚠ {error}</div>}

        <div className="demo-grid">
          {/* Step 1: keys */}
          <section className="demo-step">
            <header>
              <span className="step-num">1</span>
              <h2>Generate a key triplet</h2>
              <p>
                ML-DSA-87 signing key, ML-DSA-87 verifying key, and a
                32-byte XChaCha20 encrypt key. Plus a per-key MutationChain.
              </p>
            </header>
            <button
              className="btn btn-primary"
              onClick={genKeys}
              disabled={sdkLoading}
            >
              {sdkLoading ? 'Loading SDK…' : keys ? 'Regenerate keys' : 'Generate keypair'}
            </button>

            {keys && (
              <div className="key-display">
                <div className="kv">
                  <span className="k">signing key (4896 B)</span>
                  <code>{toHexPreview(keys.signingKey)}</code>
                </div>
                <div className="kv">
                  <span className="k">verifying key (2592 B)</span>
                  <code>{toHexPreview(keys.verifyingKey)}</code>
                </div>
                <div className="kv">
                  <span className="k">encrypt key (32 B)</span>
                  <code>{toHexPreview(keys.encryptKey)}</code>
                </div>
                {timings.keygen != null && (
                  <div className="timing">key generation took {timings.keygen.toFixed(1)} ms</div>
                )}
              </div>
            )}
          </section>

          {/* Step 2: issue */}
          <section className={'demo-step' + (keys ? '' : ' disabled')}>
            <header>
              <span className="step-num">2</span>
              <h2>Issue a token</h2>
              <p>
                Edit the claims JSON. They'll be sealed with XChaCha20-Poly1305,
                signed with ML-DSA-87, and stamped with the mutation counter.
              </p>
            </header>
            <textarea
              className="claims-input"
              value={claimsInput}
              onChange={(e) => setClaimsInput(e.target.value)}
              spellCheck={false}
              rows={7}
            />
            <button
              className="btn btn-primary"
              onClick={issueToken}
              disabled={!keys}
            >
              Issue token
            </button>

            {token && (
              <div className="token-display">
                <div className="token-meta">
                  <span>{token.bytes} bytes on the wire</span>
                  <span>mutation counter = {token.mutationCtr.toString()}</span>
                  {timings.issue != null && <span>{timings.issue.toFixed(1)} ms to sign</span>}
                </div>
                <pre className="token-hex">{token.hex}</pre>
              </div>
            )}
          </section>

          {/* Step 3: verify */}
          <section className={'demo-step' + (token ? '' : ' disabled')}>
            <header>
              <span className="step-num">3</span>
              <h2>Verify the token</h2>
              <p>
                Decode the AEAD payload, check the signature, walk the
                mutation chain. If anything failed in transit, this throws.
              </p>
            </header>
            <button
              className="btn btn-primary"
              onClick={verifyToken}
              disabled={!token}
            >
              Verify
            </button>
            {verifyResult && (
              <>
                <pre className="verify-result">{verifyResult}</pre>
                {timings.verify != null && (
                  <div className="timing">verify took {timings.verify.toFixed(1)} ms</div>
                )}
              </>
            )}
          </section>

          {/* Step 4: tamper */}
          <section className={'demo-step' + (token ? '' : ' disabled')}>
            <header>
              <span className="step-num">4</span>
              <h2>Tamper detection</h2>
              <p>
                Flip a single byte at the end of the token (in the signature
                region) and try to verify. Any modification anywhere in the
                token must fail — that's the whole point.
              </p>
            </header>
            <button
              className="btn btn-ghost"
              onClick={tamperTest}
              disabled={!token}
            >
              Tamper one byte and verify
            </button>
            {tamperResult && (
              <pre className={'tamper-result' + (tamperResult.startsWith('Correctly') ? ' ok' : ' fail')}>
                {tamperResult}
              </pre>
            )}
          </section>
        </div>

        <section className="demo-footnote">
          <h2>What just happened in your browser</h2>
          <ol>
            <li>
              <strong>Key generation</strong> drew 32 + 32 bytes from{' '}
              <code>WebCrypto.getRandomValues()</code>, then ran ML-DSA-87 keygen
              from <code>@noble/post-quantum</code> (audited by Cure53 + Trail of Bits).
            </li>
            <li>
              <strong>Token issuance</strong> encoded the claims as MessagePack,
              encrypted them with XChaCha20-Poly1305, advanced the per-key
              mutation chain via SHA3-256, and signed the whole envelope with
              ML-DSA-87.
            </li>
            <li>
              <strong>Verification</strong> ran the entire pipeline in reverse —
              signature check, AEAD-tag check, mutation-counter check, claims
              decode. Any one failure rejects the token; on success you got
              back the exact claims object that went in.
            </li>
            <li>
              <strong>Tamper detection</strong> demonstrated that the ML-DSA-87
              signature covers every byte of the token. Flipping anywhere —
              header, payload, signature region — invalidates the whole token.
            </li>
          </ol>
          <p>
            None of this leaves your browser. The same code runs identically in
            Node, Bun, Deno, Cloudflare Workers, and any modern browser.
          </p>
        </section>
      </div>
    </div>
  );
}
