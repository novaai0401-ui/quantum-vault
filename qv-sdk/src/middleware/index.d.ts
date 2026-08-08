// Type declarations for @sigvault/sdk middlewares.
// SPDX-License-Identifier: Apache-2.0

export interface SigvaultMiddlewareOptions {
  /** Remote mode: base URL of a running qv-server. */
  serverUrl?: string;
  /** Local mode key id (also narrows remote mode to /v3/token/verify). */
  keyId?: string;
  /** Local mode: ML-DSA-87 verifying key bytes. */
  verifyingKey?: Uint8Array;
  /** Local mode: XChaCha20 claims key bytes. */
  encryptKey?: Uint8Array;
  /** Local mode: ChainStore with observe(); defaults to InMemoryChainStore. */
  store?: { observe(keyId: string, counter: bigint): Promise<void> };
  /** Header to read the token from. Default 'authorization'. */
  header?: string;
  /** Expected prefix; '' = raw header value. Default 'Bearer'. */
  scheme?: string;
  /** Custom token extractor; overrides header/scheme. */
  getToken?: (req: unknown) => string | null;
  /** Request property to attach the verify result to. Default 'sigvault'. */
  property?: string;
}

export interface SigvaultVerifyResult {
  valid: boolean;
  keyId?: string;
  claims: Record<string, unknown>;
  [k: string]: unknown;
}

export function extractToken(
  req: { headers?: Record<string, string | string[] | undefined> },
  opts?: { header?: string; scheme?: string },
): string | null;

export function createTokenVerifier(
  options?: SigvaultMiddlewareOptions,
): (token: string) => Promise<SigvaultVerifyResult>;

export function sigvaultExpress(
  options?: SigvaultMiddlewareOptions,
): (req: any, res: any, next: (err?: unknown) => void) => Promise<void>;

export function sigvaultFastify(
  fastify: any,
  opts?: SigvaultMiddlewareOptions,
): Promise<void>;
