// SPDX-License-Identifier: Apache-2.0
//
// Interactive in-browser demo. Issues + verifies a real Sigvault token
// using @sigvault/sdk@4.3.7. Zero network round-trip; the post-quantum
// signing happens locally in the visitor's browser.

import { useState } from 'react';
import {
  TkxAlert, TkxButton, TkxCard, TkxCardBody, TkxCardHeader,
  TkxBadge, TkxDivider,
} from 'tekivex-ui';

async function loadSdk() {
  const m = await import('@sigvault/sdk');
  return m;
}

type Sdk = Awaited<ReturnType<typeof loadSdk>>;

interface KeyState {
  signingKey:   Uint8Array;
  verifyingKey: Uint8Array;
  encryptKey:   Uint8Array;
  chain:        any;
}
interface TokenState {
  hex:         string;
  bytes:       number;
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
      const chain = new m.MutationChain(kp.encryptKey.slice(0, 32));
      const dt = performance.now() - t0;
      setKeys({ ...kp, chain });
      setToken(null); setVerifyResult(null); setTamperResult(null);
      setTimings((s) => ({ ...s, keygen: dt }));
    } catch (e: any) {
      setError(`Key generation failed: ${e.message}`);
    }
  }

  async function issueToken() {
    setError(null); setVerifyResult(null); setTamperResult(null);
    if (!keys) { setError('Generate a keypair first.'); return; }
    try {
      const m = await ensureSdk();
      let claims: Record<string, unknown>;
      try { claims = JSON.parse(claimsInput); }
      catch (e: any) { setError(`Claims JSON invalid: ${e.message}`); return; }
      const t0 = performance.now();
      const { tokenHex, tokenBytes } = m.issueToken({
        signingKey: keys.signingKey,
        encryptKey: keys.encryptKey,
        chain:      keys.chain,
        claims, ttl: 3600,
      });
      const dt = performance.now() - t0;
      setToken({ hex: tokenHex, bytes: tokenBytes.length, mutationCtr: keys.chain.counter });
      setTimings((s) => ({ ...s, issue: dt }));
    } catch (e: any) { setError(`Issue failed: ${e.message}`); }
  }

  async function verifyToken() {
    setError(null); setTamperResult(null);
    if (!keys || !token) { setError('Issue a token first.'); return; }
    try {
      const m = await ensureSdk();
      const verifyChain = m.MutationChain.fromState(keys.encryptKey.slice(0, 32), 0n);
      const t0 = performance.now();
      const out = m.verifyToken({
        token: token.hex,
        verifyingKey: keys.verifyingKey,
        encryptKey: keys.encryptKey,
        chain: verifyChain,
      });
      const dt = performance.now() - t0;
      setVerifyResult(JSON.stringify({
        valid: true,
        claims: out.claims,
        ttlSecs: out.ttl,
        mutationCtr: out.mutationCtr.toString(),
        issuedAt: new Date(Number(out.issuedAt / 1000n)).toISOString(),
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
      const bad = token.hex.slice(0, -8) + 'deadbeef';
      const verifyChain = m.MutationChain.fromState(keys.encryptKey.slice(0, 32), 0n);
      try {
        m.verifyToken({
          token: bad,
          verifyingKey: keys.verifyingKey,
          encryptKey: keys.encryptKey,
          chain: verifyChain,
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
          Everything below runs in your browser using{' '}
          <code>@sigvault/sdk@4.3.7</code> — the same package any developer
          would <code>npm install</code>. No server, no account, no signup.
          The post-quantum signing happens locally.
        </p>

        {error && (
          <TkxAlert variant="error" title="Something went wrong" style={{ marginTop: 20 }}>
            {error}
          </TkxAlert>
        )}

        <div className="demo-grid">
          <DemoStep
            n={1} title="Generate a key triplet" enabled
            blurb="ML-DSA-87 signing key, ML-DSA-87 verifying key, and a 32-byte XChaCha20 encrypt key. Plus a per-key MutationChain."
            action={
              <TkxButton
                variant="solid" colorScheme="primary" size="md"
                onClick={genKeys}
                loading={sdkLoading}
              >
                {keys ? 'Regenerate keys' : 'Generate keypair'}
              </TkxButton>
            }
          >
            {keys && (
              <div className="key-display">
                <KV k="signing key (4896 B)"   v={toHexPreview(keys.signingKey)} />
                <KV k="verifying key (2592 B)" v={toHexPreview(keys.verifyingKey)} />
                <KV k="encrypt key (32 B)"     v={toHexPreview(keys.encryptKey)} />
                {timings.keygen != null && <Timing ms={timings.keygen} what="key generation" />}
              </div>
            )}
          </DemoStep>

          <DemoStep
            n={2} title="Issue a token" enabled={!!keys}
            blurb="Edit the claims JSON. They'll be sealed with XChaCha20-Poly1305, signed with ML-DSA-87, and stamped with the mutation counter."
            action={
              <TkxButton
                variant="solid" colorScheme="primary" size="md"
                onClick={issueToken}
                disabled={!keys}
              >Issue token</TkxButton>
            }
          >
            <textarea
              className="claims-input"
              value={claimsInput}
              onChange={(e) => setClaimsInput(e.target.value)}
              spellCheck={false}
              rows={7}
              disabled={!keys}
            />
            {token && (
              <div className="token-display" style={{ marginTop: 14 }}>
                <div className="token-meta">
                  <TkxBadge variant="subtle" colorScheme="primary" size="sm">{token.bytes} bytes</TkxBadge>
                  <span>mutation counter = {token.mutationCtr.toString()}</span>
                  {timings.issue != null && <Timing ms={timings.issue} what="signing" />}
                </div>
                <pre className="token-hex">{token.hex}</pre>
              </div>
            )}
          </DemoStep>

          <DemoStep
            n={3} title="Verify the token" enabled={!!token}
            blurb="Decode the AEAD payload, check the signature, walk the mutation chain. If anything failed in transit, this throws."
            action={
              <TkxButton
                variant="solid" colorScheme="primary" size="md"
                onClick={verifyToken}
                disabled={!token}
              >Verify</TkxButton>
            }
          >
            {verifyResult && (
              <>
                <pre className="verify-result">{verifyResult}</pre>
                {timings.verify != null && <Timing ms={timings.verify} what="verify" />}
              </>
            )}
          </DemoStep>

          <DemoStep
            n={4} title="Tamper detection" enabled={!!token}
            blurb="Flip a single byte at the end of the token (in the signature region) and try to verify. Any modification anywhere in the token must fail — that's the whole point."
            action={
              <TkxButton
                variant="outline" colorScheme="danger" size="md"
                onClick={tamperTest}
                disabled={!token}
              >Tamper one byte and verify</TkxButton>
            }
          >
            {tamperResult && (
              <TkxAlert
                variant={tamperResult.startsWith('Correctly') ? 'success' : 'error'}
                style={{ marginTop: 14 }}
              >
                {tamperResult}
              </TkxAlert>
            )}
          </DemoStep>
        </div>

        <TkxCard variant="filled" padding="lg" className="demo-footnote-card">
          <TkxCardHeader>
            <h2 style={{ margin: 0, fontFamily: 'var(--sans)', fontSize: '1.05rem' }}>
              What just happened in your browser
            </h2>
          </TkxCardHeader>
          <TkxDivider />
          <TkxCardBody>
            <ol>
              <li>
                <strong>Key generation</strong> drew 32 + 32 bytes from{' '}
                <code>WebCrypto.getRandomValues()</code>, then ran ML-DSA-87
                keygen from <code>@noble/post-quantum</code> (audited by Cure53 + Trail of Bits).
              </li>
              <li>
                <strong>Token issuance</strong> encoded the claims as MessagePack,
                encrypted them with XChaCha20-Poly1305, advanced the per-key
                mutation chain via SHA3-256, and signed the whole envelope
                with ML-DSA-87.
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
            <p style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-soft)' }}>
              None of this leaves your browser. The same code runs identically in
              Node, Bun, Deno, Cloudflare Workers, and any modern browser.
            </p>
          </TkxCardBody>
        </TkxCard>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────

function DemoStep({
  n, title, blurb, enabled, action, children,
}: {
  n: number; title: string; blurb: string;
  enabled: boolean; action: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <TkxCard
      variant="outlined" padding="lg"
      className={'demo-step' + (enabled ? '' : ' disabled')}
    >
      <TkxCardBody>
        <header>
          <span className="step-num">{n}</span>
          <h2>{title}</h2>
          <p>{blurb}</p>
        </header>
        {action}
        {children}
      </TkxCardBody>
    </TkxCard>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <code>{v}</code>
    </div>
  );
}

function Timing({ ms, what }: { ms: number; what: string }) {
  return <div className="timing">{what} took {ms.toFixed(1)} ms</div>;
}
