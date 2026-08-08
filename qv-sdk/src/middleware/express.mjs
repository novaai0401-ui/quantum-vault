// Sigvault — Express middleware. No express import needed: this is a
// plain (req, res, next) function, so it also works with Connect,
// Polka, and bare node:http routers that follow the same signature.
//
// Usage:
//   import { sigvaultExpress } from '@sigvault/sdk/middleware/express';
//   app.use('/api', sigvaultExpress({ serverUrl: 'http://localhost:7433' }));
//   app.get('/api/me', (req, res) => res.json(req.sigvault.claims));
//
// SPDX-License-Identifier: Apache-2.0

import { createTokenVerifier, extractToken } from './core.mjs';

/**
 * @param {object} options — see core.mjs for {serverUrl} vs
 *   {keyId, verifyingKey, encryptKey, store} modes, plus:
 * @param {string}   [options.header='authorization'] header to read
 * @param {string}   [options.scheme='Bearer'] prefix; '' = raw header value
 * @param {Function} [options.getToken] custom (req) => token extractor
 * @param {string}   [options.property='sigvault'] req property for the result
 */
export function sigvaultExpress(options = {}) {
  const verify   = createTokenVerifier(options);
  const getToken = options.getToken ?? ((req) => extractToken(req, options));
  const property = options.property ?? 'sigvault';

  return async function sigvaultMiddleware(req, res, next) {
    const token = getToken(req);
    if (!token) return unauthorized(res, 'TOKEN_MISSING', 'no bearer token in request');
    try {
      req[property] = await verify(token);
      next();
    } catch (e) {
      unauthorized(res, e.code || 'TOKEN_INVALID', e.message);
    }
  };
}

function unauthorized(res, code, message) {
  const payload = JSON.stringify({ error: { code, message } });
  // Express res or bare ServerResponse — support both.
  if (typeof res.status === 'function') {
    res.status(401).type('application/json').send(payload);
  } else {
    res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
    res.end(payload);
  }
}
