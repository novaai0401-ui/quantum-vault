import { TkxBadge, TkxAlert } from 'tekivex-ui';

type Row = {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  desc: string;
  body?: string;
  resp?: string;
};

const endpoints: Row[] = [
  { method: 'GET',  path: '/v3/health',  desc: 'Liveness probe.',
    resp: `{ "status": "ok", "version": "4.1-γ", "uptimeSec": 12 }` },
  { method: 'GET',  path: '/v3/spec',    desc: 'Machine-readable feature matrix.',
    resp: `{ "suites": ["ml-dsa-87"], "falconReserved": true, "workers": 4 }` },
  { method: 'POST', path: '/v3/keygen',  desc: 'Generate a new signing key, seal at rest.',
    body: `{ "label": "prod-us-east-1" }`,
    resp: `{ "keyId": "8b0a…", "label": "…", "createdAt": "2026-…", "verifyingKeyB64": "…" }` },
  { method: 'POST', path: '/v3/token/issue', desc: 'Mint a token. Advances the mutation chain.',
    body: `{
  "keyId":   "8b0a…",
  "claims":  { "sub": "alice", "role": "admin" },
  "ttl":     3600,
  "suite":   "dilithium5",            // ml-dsa-87
  "tokenType": "access"               // or "refresh" / "service"
}`,
    resp: `{
  "tokenHex": "51564c54…",
  "tokenB64": "UVZMVAM…",
  "sizeBytes": 4810,
  "issuedAt": "2026-…", "ttlSecs": 3600, "mutationCtr": 17
}` },
  { method: 'POST', path: '/v3/token/verify', desc: 'Single-token verify. Checks signature, expiry, chain.',
    body: `{ "keyId": "8b0a…", "token": "51564c54…" }`,
    resp: `{ "valid": true, "claims": {...}, "mutationCtr": 17 }` },
  { method: 'POST', path: '/v3/token/batch-verify',
    desc: 'Verify up to 256 tokens per request. Uses the worker pool (v4.1).',
    body: `{ "items": [ { "keyId": "…", "token": "…" }, … ] }`,
    resp: `{
  "results": [ { "index": 0, "valid": true, "claims": {...} }, … ],
  "summary": { "total": 200, "valid": 200, "invalid": 0,
               "durationMs": 358.4, "throughput": 558, "workers": 4 }
}` },
  { method: 'POST', path: '/v3/token/inspect',
    desc: 'Parse a token without verifying — returns header + claims layout.',
    body: `{ "token": "51564c54…" }`,
    resp: `{ "magic": "QVLT", "version": 3, "suite": 5, "tokenType": 0, "mutationCtr": 17 }` },
  { method: 'GET',  path: '/v3/keys', desc: 'JWKS-equivalent: list all keys and their verifying material.',
    resp: `[ { "keyId": "…", "label": "…", "algorithm": "ML-DSA-87", "revoked": false, "verifyingKeyB64": "…" } ]` },
  { method: 'GET',  path: '/v3/keys/:id',          desc: 'Single-key metadata.' },
  { method: 'GET',  path: '/v3/keys/:id/vk.bin',   desc: 'Raw verifying key bytes (binary). Cacheable.' },
  { method: 'DELETE', path: '/v3/keys/:id',        desc: 'Revoke a key. Persistent. Subsequent issue/verify return 410 Gone.' },
  { method: 'GET',  path: '/v3/revoked',           desc: 'List all revoked keyIds.' },
];

export default function ApiRef() {
  return (
    <>
      <h1>REST API reference</h1>
      <p className="lead">
        The sovereign server binds to <code>0.0.0.0:7433</code> by default
        and speaks JSON over plain HTTP. Terminate TLS at your reverse
        proxy (nginx, Caddy, Cloudflare). All requests are idempotent
        except <code>/v3/token/issue</code> (which advances the mutation chain).
      </p>

      <TkxAlert variant="warning" title="Authentication">
        The server ships without auth on purpose — it's a crypto engine,
        not a gateway. Put it behind your own auth mesh (mTLS, bearer
        tokens, VPC-only, whichever). See the Architecture page for threat
        model.
      </TkxAlert>

      <h2>Endpoints</h2>
      <table>
        <thead>
          <tr>
            <th style={{ width: 90 }}>Method</th>
            <th>Path</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {endpoints.map((e) => (
            <tr key={e.method + e.path}>
              <td>
                <TkxBadge
                  size="sm"
                  colorScheme={
                    e.method === 'GET' ? 'success'
                    : e.method === 'POST' ? 'primary'
                    : 'warning'
                  }
                >
                  {e.method}
                </TkxBadge>
              </td>
              <td><code>{e.path}</code></td>
              <td>{e.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {endpoints.filter(e => e.body || e.resp).map((e) => (
        <section key={e.path + '-full'}>
          <h3>
            <TkxBadge
              size="sm"
              colorScheme={
                e.method === 'GET' ? 'success'
                : e.method === 'POST' ? 'primary'
                : 'warning'
              }
              style={{ marginRight: 8 }}
            >
              {e.method}
            </TkxBadge>
            <code>{e.path}</code>
          </h3>
          <p>{e.desc}</p>
          {e.body && <>
            <div className="qv-mut">Request body</div>
            <pre><code>{e.body}</code></pre>
          </>}
          {e.resp && <>
            <div className="qv-mut">Response</div>
            <pre><code>{e.resp}</code></pre>
          </>}
        </section>
      ))}

      <h2>Error shape</h2>
      <pre><code>{`{ "error": { "code": "KEY_NOT_FOUND", "message": "…" } }`}</code></pre>
      <p>
        All 4xx/5xx responses use this envelope. Known codes include{' '}
        <code>MISSING_KEY_ID</code>, <code>KEY_NOT_FOUND</code>,{' '}
        <code>KEY_REVOKED</code> (HTTP 410), <code>INVALID_TOKEN</code>,{' '}
        <code>MISSING_CLAIMS</code>, <code>BATCH_TOO_LARGE</code>,{' '}
        <code>INVALID_SUITE</code>, <code>ISSUE_FAILED</code>.
      </p>
    </>
  );
}
