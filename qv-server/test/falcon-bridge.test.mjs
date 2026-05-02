// falcon-bridge.mjs — unit tests.
//
// We DO require a built qv-cli for the round-trip test; that's gated on
// the binary being discoverable. Pure-input-validation tests run
// unconditionally.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

import {
  probeFalconCli, falconSign, falconVerify, __testing,
} from '../falcon-bridge.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO      = resolve(__dirname, '..', '..');

function findCli() {
  const exts = process.platform === 'win32' ? ['.exe', ''] : [''];
  for (const ext of exts) {
    for (const p of [
      join(REPO, 'target', 'release', 'qv' + ext),
      join(REPO, 'target', 'debug',   'qv' + ext),
    ]) if (existsSync(p)) return p;
  }
  return null;
}

const CLI = findCli();
const SKIP_LIVE = !CLI;

test('probeFalconCli returns shape on this host', () => {
  const p = probeFalconCli();
  assert.equal(typeof p.available, 'boolean');
  if (p.available) {
    assert.equal(p.falconBuilt, true);
    assert.equal(typeof p.path, 'string');
  } else {
    assert.equal(typeof p.reason, 'string');
  }
});

test('falconSign rejects bad n', async () => {
  await assert.rejects(
    falconSign({ signingKey: Buffer.alloc(32), message: Buffer.from('x'), n: 256 }),
    (err) => err.code === 'FALCON_BAD_N');
});

test('falconSign rejects non-Buffer inputs', async () => {
  await assert.rejects(
    falconSign({ signingKey: 'string', message: Buffer.from('x'), n: 512 }),
    (err) => err.code === 'FALCON_BAD_INPUT');
});

test('falconVerify rejects bad n', async () => {
  await assert.rejects(
    falconVerify({ verifyingKey: Buffer.alloc(32), message: Buffer.from('x'), signature: Buffer.alloc(0), n: 999 }),
    (err) => err.code === 'FALCON_BAD_N');
});

// ─── Live round-trip — requires qv-cli on disk ───────────────────────────────

test('round-trip: keygen → sign → verify (Falcon-512)', { skip: SKIP_LIVE }, async () => {
  // Use qv-cli to mint keys (we don't have a JS Falcon).
  const dir = mkdtempSync(join(tmpdir(), 'qv-falcon-rt-'));
  const sk = join(dir, 'sk.bin'), vk = join(dir, 'vk.bin');
  try {
    const r = spawnSync(CLI, ['falcon-keygen', '--n', '512', '--sk-out', sk, '--vk-out', vk]);
    assert.equal(r.status, 0, `keygen failed: ${r.stderr?.toString()}`);
    const skBytes = (await import('node:fs')).readFileSync(sk);
    const vkBytes = (await import('node:fs')).readFileSync(vk);

    const msg = Buffer.from('hello quantum world');
    const sig = await falconSign({ signingKey: skBytes, message: msg, n: 512 });
    assert.ok(sig.length > 0 && sig.length < 1500, `unexpected sig length ${sig.length}`);

    const ok = await falconVerify({ verifyingKey: vkBytes, message: msg, signature: sig, n: 512 });
    assert.equal(ok, true);

    // Tampered message: verify returns false (NOT throws).
    const tampered = Buffer.from('hello quantum WORLD');
    const ok2 = await falconVerify({ verifyingKey: vkBytes, message: tampered, signature: sig, n: 512 });
    assert.equal(ok2, false);

    // Tampered signature: verify returns false too.
    const badSig = Buffer.from(sig); badSig[0] ^= 0xff;
    const ok3 = await falconVerify({ verifyingKey: vkBytes, message: msg, signature: badSig, n: 512 });
    assert.equal(ok3, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('round-trip: Falcon-1024 also works', { skip: SKIP_LIVE }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qv-falcon-1024-'));
  const sk = join(dir, 'sk.bin'), vk = join(dir, 'vk.bin');
  try {
    const r = spawnSync(CLI, ['falcon-keygen', '--n', '1024', '--sk-out', sk, '--vk-out', vk]);
    assert.equal(r.status, 0, `keygen failed: ${r.stderr?.toString()}`);
    const skBytes = (await import('node:fs')).readFileSync(sk);
    const vkBytes = (await import('node:fs')).readFileSync(vk);

    const msg = randomBytes(256);
    const sig = await falconSign({ signingKey: skBytes, message: msg, n: 1024 });
    assert.ok(sig.length > 0);
    const ok = await falconVerify({ verifyingKey: vkBytes, message: msg, signature: sig, n: 1024 });
    assert.equal(ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
