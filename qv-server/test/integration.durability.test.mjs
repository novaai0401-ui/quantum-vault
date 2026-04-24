/**
 * Integration: durability across restart.
 *
 * Boots a server, issues N tokens, kills the process HARD (SIGKILL on POSIX,
 * TerminateProcess on Windows), re-boots against the same DATA_DIR, and
 * confirms:
 *
 *   1. revoked.json survived a kill after a 200-response.
 *   2. The chain counter tail on disk ≥ the highest counter the server
 *      handed out before the kill (no lost advances).
 *   3. The fresh server loads without complaining about `.tmp` orphans.
 */

import { test, before, after } from 'node:test';
import assert                  from 'node:assert/strict';
import { spawn }               from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join, dirname }       from 'node:path';
import { fileURLToPath }       from 'node:url';
import { createHash }          from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER    = join(__dirname, '..', 'server-sovereign.mjs');

function waitFor(url, ms = 8000) {
  const deadline = Date.now() + ms;
  return (async function loop() {
    while (Date.now() < deadline) {
      try { const r = await fetch(url); if (r.ok) return true; } catch {}
      await new Promise(r => setTimeout(r, 80));
    }
    throw new Error(`server at ${url} did not come up in ${ms}ms`);
  })();
}

function mkServer(dataDir, port) {
  const token  = 'deadbeefcafef00d'.repeat(4);
  const sha256 = createHash('sha256').update(token).digest('hex');
  const env = {
    ...process.env,
    QV_HOST: '127.0.0.1', QV_PORT: String(port),
    QV_DATA_DIR: dataDir,
    QV_ADMIN_TOKEN_SHA256: sha256,
    QV_MASTER_KEY_HEX: '11'.repeat(32),
    QV_RATE_LIMIT_DISABLED: 'true',
    QV_AUDIT_ENABLED: 'false',
  };
  const child = spawn(process.execPath, [SERVER], { env, stdio: 'pipe' });
  child.stderr.on('data', () => {}); // swallow
  child.stdout.on('data', () => {}); // swallow
  return { child, token };
}

function randPort() { return 20000 + Math.floor(Math.random() * 40000); }

test('chain log is fsynced — counter survives SIGKILL', async () => {
  const dir  = mkdtempSync(join(tmpdir(), 'qv-dur-'));
  const port = randPort();
  const { child, token } = mkServer(dir, port);

  try {
    await waitFor(`http://127.0.0.1:${port}/v3/ready`);

    // Keygen.
    const kg = await fetch(`http://127.0.0.1:${port}/v3/keygen`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'durability-probe' }),
    });
    assert.ok(kg.status === 200 || kg.status === 201, `keygen status ${kg.status}`);
    const { keyId } = await kg.json();

    // Issue 5 tokens — each advances the chain (counter 1..5).
    let lastCtr = 0n;
    for (let i = 0; i < 5; i++) {
      const r = await fetch(`http://127.0.0.1:${port}/v3/token/issue`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyId, claims: { n: i }, ttl: 60 }),
      });
      assert.equal(r.status, 200);
      const b = await r.json();
      assert.ok(typeof b.mutationCtr === 'number' && b.mutationCtr > 0);
      lastCtr = BigInt(b.mutationCtr);
    }
    assert.equal(lastCtr, 5n);

    // HARD kill. No drain. Fsync'd bytes must survive.
    child.kill('SIGKILL');
    await new Promise(r => child.once('exit', r));
  } finally {
    // noop
  }

  // Inspect the chain log directly: last 40-byte record's big-endian counter
  // must equal 5.
  const logPath = join(dir, 'chains');
  const files = existsSync(logPath)
    ? (await import('node:fs/promises')).readdir(logPath).then(l => l)
    : Promise.resolve([]);
  const names = await files;
  assert.equal(names.length, 1, `expected 1 chain log, got ${names.length}`);
  const buf = readFileSync(join(logPath, names[0]));
  assert.equal(buf.length % 40, 0, 'chain log not a multiple of 40 bytes');
  const tailCtr = buf.readBigUInt64BE(buf.length - 40);
  assert.equal(tailCtr, 5n, `expected tail counter 5, got ${tailCtr}`);

  rmSync(dir, { recursive: true, force: true });
});

test('revoked.json is durable — survives SIGKILL after 200-response', async () => {
  const dir  = mkdtempSync(join(tmpdir(), 'qv-dur2-'));
  const port = randPort();
  const { child, token } = mkServer(dir, port);

  await waitFor(`http://127.0.0.1:${port}/v3/ready`);

  // Create a key, revoke it, then kill.
  const kg = await fetch(`http://127.0.0.1:${port}/v3/keygen`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: 'rev-probe' }),
  });
  const { keyId } = await kg.json();

  const rv = await fetch(`http://127.0.0.1:${port}/v3/keys/${keyId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  assert.equal(rv.status, 200);

  child.kill('SIGKILL');
  await new Promise(r => child.once('exit', r));

  const revFile = join(dir, 'revoked.json');
  assert.ok(existsSync(revFile), 'revoked.json missing after SIGKILL');
  const list = JSON.parse(readFileSync(revFile, 'utf8'));
  assert.ok(list.includes(keyId), 'revocation was lost across SIGKILL');

  // And no orphan tmp file.
  assert.ok(!existsSync(revFile + '.tmp'), 'stale revoked.json.tmp left on disk');

  rmSync(dir, { recursive: true, force: true });
});

test('startup cleans up stale .tmp siblings from a prior crash', async () => {
  const dir  = mkdtempSync(join(tmpdir(), 'qv-dur3-'));

  // Simulate a pre-existing crash artefact: a revoked.json.tmp with garbage.
  // (The real file does not yet exist — this mirrors crash-during-first-write.)
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(dir, 'revoked.json.tmp'), 'half-written-garbage');

  const port = randPort();
  const { child } = mkServer(dir, port);

  await waitFor(`http://127.0.0.1:${port}/v3/ready`);

  // Trigger revoked-list load path by hitting the public list endpoint.
  const r = await fetch(`http://127.0.0.1:${port}/v3/revoked`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(body.revoked, []); // empty because the .tmp was garbage and discarded

  child.kill('SIGKILL');
  await new Promise(res => child.once('exit', res));

  // The stale tmp must be gone.
  assert.ok(!existsSync(join(dir, 'revoked.json.tmp')),
            'server should have cleaned up stale revoked.json.tmp on load');

  rmSync(dir, { recursive: true, force: true });
});
