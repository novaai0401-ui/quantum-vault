/**
 * QuantumVault — Security headers + CORS lockdown
 * ===================================================
 * Zero npm deps. Applied by the dispatcher on every response.
 *
 * Headers emitted by default:
 *   Strict-Transport-Security: max-age=31536000; includeSubDomains
 *     (disable with QV_HSTS_ENABLED=false when serving plain HTTP in dev)
 *   X-Content-Type-Options: nosniff
 *   X-Frame-Options: DENY
 *   Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'
 *   Referrer-Policy: no-referrer
 *   Cross-Origin-Resource-Policy: same-origin
 *   Cross-Origin-Opener-Policy: same-origin
 *   X-Permitted-Cross-Domain-Policies: none
 *
 * Intentionally NOT emitted:
 *   Server: <anything>           (never leak version)
 *   X-Powered-By: <anything>     (never leak framework)
 *
 * CORS policy:
 *   QV_CORS_ORIGINS = "https://a.com,https://b.com"   whitelist, echo on match
 *   QV_CORS_ORIGIN  = "https://a.com"    (back-compat single origin)
 *   QV_CORS_ORIGIN  = "*"                open — PROHIBITED when
 *                                        QV_CORS_ALLOW_CREDENTIALS is in use
 *   (empty)                              no CORS headers at all (default)
 *
 * Allowed methods/headers are fixed to the surface qv-server actually exposes.
 */

// ─── Header bundle ──────────────────────────────────────────────────────────

export function loadSecurityConfig(env = process.env) {
  const hstsEnabled = env.QV_HSTS_ENABLED !== 'false';        // default ON
  const hstsMaxAge  = Number(env.QV_HSTS_MAX_AGE ?? 31536000); // 1 year
  if (hstsEnabled && (!Number.isFinite(hstsMaxAge) || hstsMaxAge < 0 || hstsMaxAge > 63072000)) {
    throw new Error(`QV_HSTS_MAX_AGE must be 0..63072000 seconds (got ${env.QV_HSTS_MAX_AGE})`);
  }
  return {
    hstsEnabled,
    hstsMaxAge,
    hstsIncludeSubDomains: env.QV_HSTS_INCLUDE_SUBDOMAINS !== 'false',
    hstsPreload:           env.QV_HSTS_PRELOAD === 'true',
  };
}

export function applySecurityHeaders(res, config) {
  if (!config) return;
  // Always:
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options',        'DENY');
  res.setHeader('referrer-policy',        'no-referrer');
  res.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader('cross-origin-resource-policy', 'same-origin');
  res.setHeader('cross-origin-opener-policy',   'same-origin');
  res.setHeader('x-permitted-cross-domain-policies', 'none');

  // HSTS: only meaningful over TLS. Emit unconditionally by default — the
  // spec says UAs only honour HSTS received over HTTPS anyway, so emitting
  // on HTTP is a no-op for compliant clients. Turn off when serving plain
  // HTTP in a context where a misconfigured intermediary might cache it.
  if (config.hstsEnabled) {
    const parts = [`max-age=${config.hstsMaxAge}`];
    if (config.hstsIncludeSubDomains) parts.push('includeSubDomains');
    if (config.hstsPreload)           parts.push('preload');
    res.setHeader('strict-transport-security', parts.join('; '));
  }

  // Strip anything Node/our code has already set that would leak surface.
  try { res.removeHeader('server'); }        catch {}
  try { res.removeHeader('x-powered-by'); }  catch {}
}

// ─── CORS ───────────────────────────────────────────────────────────────────

const ALLOWED_METHODS = 'GET, POST, DELETE, OPTIONS';
const ALLOWED_HEADERS = 'content-type, authorization, x-request-id';

export function loadCorsConfig(env = process.env) {
  const originsRaw = (env.QV_CORS_ORIGINS || env.QV_CORS_ORIGIN || '').trim();
  const allowCreds = env.QV_CORS_ALLOW_CREDENTIALS === 'true';
  if (!originsRaw) {
    return { mode: 'off', allowCreds };
  }
  // Wildcard
  if (originsRaw === '*') {
    if (allowCreds) {
      throw new Error('QV_CORS_ORIGIN="*" is incompatible with QV_CORS_ALLOW_CREDENTIALS=true. Browsers block this.');
    }
    return { mode: 'wildcard', allowCreds: false };
  }
  // Explicit list
  const origins = originsRaw.split(',').map(s => s.trim()).filter(Boolean);
  for (const o of origins) {
    if (!/^https?:\/\/[^\s,*]+$/.test(o)) {
      throw new Error(`QV_CORS_ORIGINS: "${o}" is not a valid http(s) origin`);
    }
  }
  return { mode: 'list', origins: new Set(origins), allowCreds };
}

/**
 * Apply CORS headers (if configured) for a given request/response pair.
 * Returns true if the response should be terminated as a preflight.
 */
export function applyCors(req, res, config) {
  if (!config || config.mode === 'off') return false;
  const reqOrigin = req?.headers?.origin;
  let allowOrigin = null;
  if (config.mode === 'wildcard') {
    allowOrigin = '*';
  } else if (config.mode === 'list' && reqOrigin && config.origins.has(reqOrigin)) {
    allowOrigin = reqOrigin;
    res.setHeader('vary', 'origin');
  }
  if (!allowOrigin) return false; // no CORS for this request; browsers will block it client-side

  res.setHeader('access-control-allow-origin',  allowOrigin);
  res.setHeader('access-control-allow-methods', ALLOWED_METHODS);
  res.setHeader('access-control-allow-headers', ALLOWED_HEADERS);
  res.setHeader('access-control-max-age',       '600');
  if (config.allowCreds) res.setHeader('access-control-allow-credentials', 'true');

  if (req?.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}
