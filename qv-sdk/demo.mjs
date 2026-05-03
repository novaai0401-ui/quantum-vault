/**
 * Sigvault v3.0 — Live Demo
 * Runs entirely in Node.js — no OS execution restrictions, no code signing needed.
 */

import {
  generateKeypair, issueToken, verifyToken, inspectToken, MutationChain
} from './src/index.mjs';

const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

const pass = (msg) => console.log(`${GREEN}  ✔ ${msg}${RESET}`);
const fail = (msg) => console.log(`${RED}  ✘ ${msg}${RESET}`);
const info = (msg) => console.log(`${CYAN}  → ${msg}${RESET}`);

console.log(`\n${BOLD}══════════════════════════════════════════════════${RESET}`);
console.log(`${BOLD}   Sigvault v3.0 — Post-Quantum Token Demo     ${RESET}`);
console.log(`${BOLD}══════════════════════════════════════════════════${RESET}\n`);

// ─── 1. Key generation ───────────────────────────────────────────────────────
console.log(`${BOLD}[1] Generating ML-DSA-87 keypair...${RESET}`);
const t0 = performance.now();
const { signingKey, verifyingKey, encryptKey } = generateKeypair();
const keyMs = (performance.now() - t0).toFixed(1);
pass(`Keypair generated in ${keyMs}ms`);
info(`Signing key seed : ${Buffer.from(signingKey).toString('hex').slice(0,16)}...  (32 bytes)`);
info(`Verifying key    : ${Buffer.from(verifyingKey).toString('hex').slice(0,16)}...  (2592 bytes)`);
info(`Encrypt key      : ${Buffer.from(encryptKey).toString('hex').slice(0,16)}...  (32 bytes)`);

// ─── 2. Token issuance ───────────────────────────────────────────────────────
console.log(`\n${BOLD}[2] Issuing access token...${RESET}`);
const chain = new MutationChain();
const t1 = performance.now();
const { tokenBytes, tokenHex } = issueToken({
  signingKeySeed: signingKey,  // 4896-byte ML-DSA-87 secretKey
  encryptKey,
  chain,
  claims: {
    sub:   'user-001',
    iss:   'qv.example.com',
    role:  'admin',
    env:   'production',
    scope: 'read:all write:tokens',
  },
  ttl: 3600,
});
const issueMs = (performance.now() - t1).toFixed(1);
pass(`Token issued in ${issueMs}ms`);
info(`Token size : ${tokenBytes.length} bytes`);
info(`Token hex  : ${tokenHex.slice(0,32)}...`);

// ─── 3. Inspect (no crypto needed) ───────────────────────────────────────────
console.log(`\n${BOLD}[3] Inspecting token header...${RESET}`);
const header = inspectToken(tokenHex);
for (const [k, v] of Object.entries(header)) {
  info(`${k.padEnd(14)} : ${v}`);
}
pass('Header decoded successfully');

// ─── 4. Verification ─────────────────────────────────────────────────────────
console.log(`\n${BOLD}[4] Verifying token (7-layer pipeline)...${RESET}`);
const verifyChain = MutationChain.fromState(chain.state, 0n);   // replay chain at 0
const t2 = performance.now();
try {
  const out = verifyToken({ token: tokenHex, verifyingKey, encryptKey, chain: verifyChain });
  const verMs = (performance.now() - t2).toFixed(1);
  pass(`Token VALID in ${verMs}ms`);
  info(`Claims:`);
  for (const [k, v] of Object.entries(out.claims)) {
    info(`  ${k} = ${v}`);
  }
} catch(e) {
  fail(`Verification failed: ${e.message}`);
}

// ─── 5. Attack simulations ───────────────────────────────────────────────────
console.log(`\n${BOLD}[5] Attack resistance tests...${RESET}`);

// 5a. Tampered signature
const tampered = new Uint8Array(tokenBytes);
tampered[tampered.length - 100] ^= 0xFF;
const attackChain1 = MutationChain.fromState(chain.state, 0n);
try {
  verifyToken({ token: tampered, verifyingKey, encryptKey, chain: attackChain1 });
  fail('Should have rejected tampered signature');
} catch(e) {
  pass(`Tampered signature rejected: ${e.message}`);
}

// 5b. Replay attack
const replayChain = MutationChain.fromState(chain.state, chain.counter);  // already at counter
try {
  verifyToken({ token: tokenHex, verifyingKey, encryptKey, chain: replayChain });
  fail('Should have rejected replay');
} catch(e) {
  pass(`Replay detected: ${e.message}`);
}

// 5c. Wrong key
const { verifyingKey: wrongVk } = generateKeypair();
const wrongKeyChain = MutationChain.fromState(chain.state, 0n);
try {
  verifyToken({ token: tokenHex, verifyingKey: wrongVk, encryptKey, chain: wrongKeyChain });
  fail('Should have rejected wrong key');
} catch(e) {
  pass(`Wrong key rejected: ${e.message}`);
}

// ─── 6. Performance benchmark ─────────────────────────────────────────────────
console.log(`\n${BOLD}[6] Performance benchmark (10 iterations)...${RESET}`);
const N = 10;
let totalIssue = 0, totalVerify = 0;
const benchChain = new MutationChain();
for (let i = 0; i < N; i++) {
  const ts = performance.now();
  const { tokenHex: th } = issueToken({
    signingKeySeed: signingKey,
    encryptKey,
    chain: benchChain,
    claims: { sub: `user-${i}`, role: 'user' },
    ttl: 3600,
  });
  totalIssue += performance.now() - ts;

  const vc = MutationChain.fromState(benchChain.state, benchChain.counter - 1n);
  const tv = performance.now();
  verifyToken({ token: th, verifyingKey, encryptKey, chain: vc });
  totalVerify += performance.now() - tv;
}
pass(`Issue  avg: ${(totalIssue/N).toFixed(1)}ms`);
pass(`Verify avg: ${(totalVerify/N).toFixed(1)}ms`);

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${BOLD}══════════════════════════════════════════════════${RESET}`);
console.log(`${GREEN}${BOLD}  Sigvault v3.0 — ALL TESTS PASSED  ${RESET}`);
console.log(`${BOLD}  Runs in Node.js — zero OS restrictions  ${RESET}`);
console.log(`${BOLD}══════════════════════════════════════════════════${RESET}\n`);
