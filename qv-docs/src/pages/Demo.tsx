import { useEffect, useState } from 'react';
import {
  TkxCard, TkxCardBody, TkxButton, TkxInput, TkxBadge, TkxAlert,
  TkxDivider, useToast,
} from 'tekivex-ui';

/**
 * Interactive demo — talks to the sovereign server over HTTP.
 *
 * Resolution order for the API base URL:
 *   1. ?api=<url> query param (lets visitors point at their own instance)
 *   2. VITE_QV_API build-time env
 *   3. localhost:7433 (works when running `node qv-server/server-sovereign.mjs`)
 */
function resolveApi(): string {
  const q = new URLSearchParams(location.search).get('api');
  if (q) return q.replace(/\/+$/, '');
  // @ts-ignore — import.meta.env is injected by Vite
  const env = import.meta.env?.VITE_QV_API;
  if (env) return String(env).replace(/\/+$/, '');
  return 'http://localhost:7433';
}

type Health = { ok: boolean; body?: any; error?: string };

export default function Demo() {
  const [api, setApi]           = useState(resolveApi());
  const [health, setHealth]     = useState<Health | null>(null);
  const [label, setLabel]       = useState('docs-demo');
  const [keyId, setKeyId]       = useState('');
  const [claimsJson, setClaims] = useState('{\n  "sub": "alice",\n  "role": "admin"\n}');
  const [ttl, setTtl]           = useState(3600);
  const [token, setToken]       = useState('');
  const [issueOut, setIssueOut] = useState('');
  const [verifyOut, setVerifyOut] = useState('');
  const [busy, setBusy]         = useState<string | null>(null);

  const toast = useToast();

  async function probe() {
    try {
      const r = await fetch(api + '/v3/health', { method: 'GET' });
      const j = await r.json();
      setHealth({ ok: r.ok, body: j });
    } catch (e: any) {
      setHealth({ ok: false, error: e.message || String(e) });
    }
  }

  useEffect(() => { probe(); /* eslint-disable-next-line */ }, [api]);

  async function doKeygen() {
    setBusy('keygen');
    try {
      const r = await fetch(api + '/v3/keygen', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label }),
      });
      const j = await r.json();
      if (j.keyId) {
        setKeyId(j.keyId);
        toast({ variant: 'success', title: 'Keypair created', description: j.keyId });
      } else {
        toast({ variant: 'error', title: 'Keygen failed', description: JSON.stringify(j) });
      }
    } catch (e: any) {
      toast({ variant: 'error', title: 'Keygen failed', description: e.message });
    } finally { setBusy(null); }
  }

  async function doIssue() {
    setBusy('issue');
    setIssueOut('');
    try {
      let claims: any;
      try { claims = JSON.parse(claimsJson); }
      catch { toast({ variant: 'error', title: 'Claims must be valid JSON' }); setBusy(null); return; }
      const r = await fetch(api + '/v3/token/issue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keyId, ttl: Number(ttl), claims }),
      });
      const j = await r.json();
      setIssueOut(JSON.stringify(j, null, 2));
      if (j.tokenHex) {
        setToken(j.tokenHex);
        toast({ variant: 'success', title: 'Token issued', description: `${j.sizeBytes} bytes` });
      } else {
        toast({ variant: 'error', title: 'Issue failed' });
      }
    } catch (e: any) {
      toast({ variant: 'error', title: 'Issue failed', description: e.message });
    } finally { setBusy(null); }
  }

  async function doVerify() {
    setBusy('verify');
    setVerifyOut('');
    try {
      const r = await fetch(api + '/v3/token/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keyId, token }),
      });
      const j = await r.json();
      setVerifyOut(JSON.stringify(j, null, 2));
      if (j.valid) toast({ variant: 'success', title: 'Verified ✓' });
      else toast({ variant: 'warning', title: 'Invalid', description: JSON.stringify(j.error ?? {}) });
    } catch (e: any) {
      toast({ variant: 'error', title: 'Verify failed', description: e.message });
    } finally { setBusy(null); }
  }

  async function doInspect() {
    setBusy('inspect');
    try {
      const r = await fetch(api + '/v3/token/inspect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const j = await r.json();
      setVerifyOut(JSON.stringify(j, null, 2));
    } finally { setBusy(null); }
  }

  return (
    <>
      <h1>Live demo</h1>
      <p className="lead">
        Every button below is one HTTP call to the sovereign server. No
        hidden state, no SDK — open DevTools and watch the requests go by.
      </p>

      <TkxCard variant="outline">
        <TkxCardBody>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div className="qv-mut" style={{ marginBottom: 4 }}>API base URL</div>
              <TkxInput
                value={api}
                onChange={(e: any) => setApi(e.target.value.replace(/\/+$/, ''))}
                placeholder="http://localhost:7433"
              />
            </div>
            <div>
              <div className="qv-mut" style={{ marginBottom: 4 }}>Server</div>
              {health === null ? (
                <TkxBadge variant="outline">probing…</TkxBadge>
              ) : health.ok ? (
                <TkxBadge colorScheme="success">
                  up · v{health.body?.version ?? '?'}
                </TkxBadge>
              ) : (
                <TkxBadge colorScheme="warning">unreachable</TkxBadge>
              )}
            </div>
            <TkxButton variant="outline" onClick={probe}>Re-probe</TkxButton>
          </div>
          <p className="qv-mut" style={{ marginTop: 10, marginBottom: 0 }}>
            Tip: append <code>?api=https://your-deployment/</code> to the
            URL to point this page at your own instance. The server ships
            with CORS allowed for <code>GET /v3/health</code> — other
            endpoints require the same origin or a proxy.
          </p>
        </TkxCardBody>
      </TkxCard>

      {health && !health.ok && (
        <TkxAlert variant="warning" title="Can't reach the server" style={{ marginTop: 16 }}>
          Start it locally with{' '}
          <code>node qv-server/server-sovereign.mjs</code>, or point the
          field above at a deployed instance.
        </TkxAlert>
      )}

      <TkxDivider style={{ margin: '28px 0' }} />

      <div className="qv-demo">
        <TkxCard variant="elevated">
          <TkxCardBody>
            <h3 style={{ marginTop: 0 }}>1 · Create a key</h3>
            <div className="qv-mut" style={{ marginBottom: 8 }}>
              POST <code>/v3/keygen</code>
            </div>
            <div style={{ marginBottom: 10 }}>
              <TkxInput
                value={label}
                onChange={(e: any) => setLabel(e.target.value)}
                placeholder="Key label"
              />
            </div>
            <TkxButton
              colorScheme="primary"
              onClick={doKeygen}
              loading={busy === 'keygen'}
              disabled={!!busy}
            >
              Generate keypair
            </TkxButton>

            {keyId && (
              <div style={{ marginTop: 16 }}>
                <div className="qv-mut">keyId</div>
                <code style={{ display: 'block', wordBreak: 'break-all' }}>{keyId}</code>
              </div>
            )}
          </TkxCardBody>
        </TkxCard>

        <TkxCard variant="elevated">
          <TkxCardBody>
            <h3 style={{ marginTop: 0 }}>2 · Issue a token</h3>
            <div className="qv-mut" style={{ marginBottom: 8 }}>
              POST <code>/v3/token/issue</code>
            </div>
            <div style={{ marginBottom: 10 }}>
              <div className="qv-mut" style={{ marginBottom: 4 }}>Claims (JSON)</div>
              <textarea
                value={claimsJson}
                onChange={(e) => setClaims(e.target.value)}
                style={{
                  width: '100%', minHeight: 110,
                  background: '#1a1f26', color: '#e6e8eb',
                  border: '1px solid #222831', borderRadius: 6,
                  padding: 10, fontFamily: 'ui-monospace, monospace',
                  fontSize: 13,
                }}
              />
            </div>
            <div style={{ marginBottom: 10, display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div className="qv-mut" style={{ marginBottom: 4 }}>TTL (seconds)</div>
                <TkxInput
                  type="number"
                  value={ttl}
                  onChange={(e: any) => setTtl(Number(e.target.value))}
                />
              </div>
            </div>
            <TkxButton
              colorScheme="primary"
              onClick={doIssue}
              loading={busy === 'issue'}
              disabled={!!busy || !keyId}
            >
              Issue token
            </TkxButton>
            {issueOut && <pre style={{ marginTop: 14 }}><code>{issueOut}</code></pre>}
          </TkxCardBody>
        </TkxCard>

        <TkxCard variant="elevated" style={{ gridColumn: '1 / -1' }}>
          <TkxCardBody>
            <h3 style={{ marginTop: 0 }}>3 · Verify / Inspect</h3>
            <div className="qv-mut" style={{ marginBottom: 8 }}>
              POST <code>/v3/token/verify</code> · POST <code>/v3/token/inspect</code>
            </div>
            <div style={{ marginBottom: 10 }}>
              <div className="qv-mut" style={{ marginBottom: 4 }}>Token (hex or base64url)</div>
              <textarea
                value={token}
                onChange={(e) => setToken(e.target.value)}
                style={{
                  width: '100%', minHeight: 80,
                  background: '#1a1f26', color: '#e6e8eb',
                  border: '1px solid #222831', borderRadius: 6,
                  padding: 10, fontFamily: 'ui-monospace, monospace',
                  fontSize: 12,
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <TkxButton
                colorScheme="primary"
                onClick={doVerify}
                loading={busy === 'verify'}
                disabled={!!busy || !keyId || !token}
              >
                Verify
              </TkxButton>
              <TkxButton
                variant="outline"
                onClick={doInspect}
                loading={busy === 'inspect'}
                disabled={!!busy || !token}
              >
                Inspect (no verify)
              </TkxButton>
            </div>
            {verifyOut && <pre style={{ marginTop: 14 }}><code>{verifyOut}</code></pre>}
          </TkxCardBody>
        </TkxCard>
      </div>
    </>
  );
}
