/**
 * CIDR allowlist for admin / metrics endpoints (limitation #5).
 *
 * Defence-in-depth on top of the bearer token: even with a valid token,
 * callers must originate from a whitelisted IP range. Intended for
 * environments where the admin surface is never meant to be reachable
 * from the public internet (classic VPN/mesh-only deployment).
 *
 * Supports IPv4 CIDR (e.g. 10.0.0.0/8) and IPv6 CIDR (e.g. fd00::/8).
 * Single IPs without a suffix are treated as /32 (v4) or /128 (v6).
 * Zero npm deps — pure stdlib.
 *
 * Env:
 *   QV_ADMIN_ALLOW_CIDRS   — comma list (empty = no allowlist, pass-through)
 *   QV_METRICS_ALLOW_CIDRS — comma list (empty = fall back to admin list)
 */

function parseV4(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const n = Number(parts[i]);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    bytes[i] = n;
  }
  return bytes;
}

function parseV6(ip) {
  // IPv4-mapped ::ffff:a.b.c.d — translate to pure v6 bytes.
  let s = ip;
  const v4mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(s);
  if (v4mapped) {
    const v4 = parseV4(v4mapped[1]);
    if (!v4) return null;
    const out = new Uint8Array(16);
    out[10] = 0xff; out[11] = 0xff;
    out[12] = v4[0]; out[13] = v4[1]; out[14] = v4[2]; out[15] = v4[3];
    return out;
  }
  // Expand '::' shorthand.
  if (s.includes('::')) {
    const [head, tail] = s.split('::');
    const hp = head ? head.split(':') : [];
    const tp = tail ? tail.split(':') : [];
    const missing = 8 - hp.length - tp.length;
    if (missing < 0) return null;
    s = [...hp, ...Array(missing).fill('0'), ...tp].join(':');
  }
  const parts = s.split(':');
  if (parts.length !== 8) return null;
  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const n = parseInt(parts[i], 16);
    if (!Number.isInteger(n) || n < 0 || n > 0xffff) return null;
    out[i * 2]     = (n >> 8) & 0xff;
    out[i * 2 + 1] = n & 0xff;
  }
  return out;
}

function parseIp(ip) {
  if (!ip) return null;
  // Strip IPv6 zone id ("fe80::1%eth0") and v4-in-v6 prefix ("::ffff:1.2.3.4").
  const cleaned = ip.replace(/%.*$/, '');
  if (cleaned.includes(':')) return { family: 6, bytes: parseV6(cleaned) };
  const v4 = parseV4(cleaned);
  return v4 ? { family: 4, bytes: v4 } : null;
}

function parseCidr(entry) {
  const [addr, maskRaw] = entry.split('/');
  const parsed = parseIp(addr);
  if (!parsed || !parsed.bytes) throw new Error(`invalid CIDR address: ${entry}`);
  const fullBits = parsed.family === 4 ? 32 : 128;
  const mask = maskRaw === undefined ? fullBits : Number(maskRaw);
  if (!Number.isInteger(mask) || mask < 0 || mask > fullBits) {
    throw new Error(`invalid CIDR mask: ${entry}`);
  }
  return { family: parsed.family, bytes: parsed.bytes, mask };
}

export function loadCidrList(raw) {
  if (!raw) return [];
  return raw.split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(parseCidr);
}

export function matchesAny(ip, list) {
  if (list.length === 0) return true; // no list = pass-through
  const parsed = parseIp(ip);
  if (!parsed || !parsed.bytes) return false;
  outer: for (const cidr of list) {
    if (cidr.family !== parsed.family) continue;
    let remaining = cidr.mask;
    for (let i = 0; remaining > 0; i++) {
      const take = Math.min(8, remaining);
      const m = (0xff << (8 - take)) & 0xff;
      if ((parsed.bytes[i] & m) !== (cidr.bytes[i] & m)) continue outer;
      remaining -= take;
    }
    return true;
  }
  return false;
}

export function loadCidrConfig(env = process.env) {
  const admin   = loadCidrList(env.QV_ADMIN_ALLOW_CIDRS);
  const metrics = env.QV_METRICS_ALLOW_CIDRS !== undefined
    ? loadCidrList(env.QV_METRICS_ALLOW_CIDRS)
    : admin;
  return { admin, metrics };
}
