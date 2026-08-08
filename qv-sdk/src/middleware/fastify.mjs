// Sigvault — Fastify plugin. No fastify import needed: a plugin is just
// an async (fastify, opts) function; register it directly.
//
// Usage:
//   import { sigvaultFastify } from '@sigvault/sdk/middleware/fastify';
//   await app.register(sigvaultFastify, { serverUrl: 'http://localhost:7433' });
//   app.get('/me', (req) => req.sigvault.claims);
//
// SPDX-License-Identifier: Apache-2.0

import { createTokenVerifier, extractToken } from './core.mjs';

/**
 * @param {import('fastify').FastifyInstance} fastify
 * @param {object} opts — same options as sigvaultExpress (see core.mjs).
 */
export async function sigvaultFastify(fastify, opts = {}) {
  const verify   = createTokenVerifier(opts);
  const getToken = opts.getToken ?? ((req) => extractToken(req, opts));
  const property = opts.property ?? 'sigvault';

  fastify.addHook('preHandler', async (req, reply) => {
    const token = getToken(req);
    if (!token) {
      return reply.code(401).send({ error: { code: 'TOKEN_MISSING', message: 'no bearer token in request' } });
    }
    try {
      req[property] = await verify(token);
    } catch (e) {
      return reply.code(401).send({ error: { code: e.code || 'TOKEN_INVALID', message: e.message } });
    }
  });
}
