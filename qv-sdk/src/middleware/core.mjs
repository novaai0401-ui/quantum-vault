// Sigvault — framework-agnostic verification core shared by the
// Express and Fastify middlewares. Zero dependencies beyond the SDK
// itself; remote mode uses global fetch (Node 18+).
//
// Two verification modes, chosen by the options you pass:
//
//   Local  — { keyId, verifyingKey, encryptKey, store? }
//            Verifies in-process with the SDK. `store` is any ChainStore
//            (implements observe()); defaults to a fresh InMemoryChainStore,
//            which gives per-process replay protection only — supply a
//            durable store for multi-process deployments.
//
//   Remote — { serverUrl, keyId? }
//            Delegates to a running qv-server. With keyId set it calls
//            POST /v3/token/verify; without, POST /v3/token/verify-auto
//            (the server trial-verifies every active key).
//
// SPDX-License-Identifier: Apache-2.0

import { verifyTokenWithStore, InMemoryChainStore } from '../index.mjs';

/**
 * Extract the raw token string from a request-like object with a
 * `headers` map. Default: `Authorization: Bearer <token>`.
 */
export function extractToken(req, { header = 'authorization', scheme = 'Bearer' } = {}) {
  const raw = req.headers?.[header.toLowerCase()];
  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (!scheme) return raw.trim();
  const prefix = scheme + ' ';
  if (!raw.startsWith(prefix)) return null;
  return raw.slice(prefix.length).trim();
}

/**
 * Build an async verifier: (tokenString) => verify result.
 * Throws on invalid tokens; the middlewares translate throws to 401s.
 */
export function createTokenVerifier(options = {}) {
  const { serverUrl, keyId, verifyingKey, encryptKey } = options;

  if (serverUrl) {
    const base = serverUrl.replace(/\/+$/, '');
    return async function verifyRemote(token) {
      const path = keyId ? '/v3/token/verify' : '/v3/token/verify-auto';
      const body = keyId ? { keyId, token } : { token };
      const resp = await fetch(base + path, {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok || !data.valid) {
        const err = new Error(data?.error?.message || 'token verification failed');
        err.code = data?.error?.code || 'TOKEN_INVALID';
        throw err;
      }
      return data;
    };
  }

  if (!verifyingKey || !encryptKey || !keyId) {
    throw new Error('sigvault middleware: pass either {serverUrl} (remote mode) or {keyId, verifyingKey, encryptKey} (local mode)');
  }
  const store = options.store ?? new InMemoryChainStore();
  return async function verifyLocal(token) {
    const out = await verifyTokenWithStore({ store, keyId, token, verifyingKey, encryptKey });
    return { valid: true, keyId, ...out };
  };
}
