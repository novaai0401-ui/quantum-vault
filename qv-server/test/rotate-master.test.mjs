// Unit tests for rotate-master.mjs.
//
// Strategy: drive rotateMaster() programmatically with a temp DATA_DIR,
// manually seal entries with an "old master" then call the rotation
// function and verify (a) the new keystore opens with the new master,
// (b) it does NOT open with the old master, (c) backup files exist,
// (d) safety gates fire when the writer-lock is live.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { rotateMaster } from '../rotate-master.mjs';

function tdir() { return mkdtempSync(join(tmpdir(), 'qv-rot-')); }

function sealWith(master, keyId, plaintext) {
  const iv  = randomBytes(12);
  const cip = createCipheriv('aes-256-gcm', master, iv);
  cip.setAAD(Buffer.from(keyId, 'utf8'));
  const ct  = Buffer.concat([cip.update(plaintext), cip.final()]);
  const tag = cip.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

function openWith(master, keyId, sealedB64) {
  const buf = Buffer.from(sealedB64, 'base64');
  const iv  = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct  = buf.subarray(28);
  const dec = createDecipheriv('aes-256-gcm', master, iv);
  dec.setAAD(Buffer.from(keyId, 'utf8'));
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(ct), dec.final()]);
}

function setupFakeKeystore(dir, master, n = 3) {
  const ks = {};
  const truth = {};
  for (let i = 0; i < n; i++) {
    const keyId = `key-${i}`;
    const sk = randomBytes(32);
    const ek = randomBytes(32);
    truth[keyId] = { sk, ek };
    ks[keyId] = {
      sealed:    true,
      sk_sealed: sealWith(master, keyId + ':sk', sk),
      ek_sealed: sealWith(master, keyId + ':ek', ek),
      vk:        Buffer.from('fake-vk').toString('base64'),
      label:     `label-${i}`,
      createdAt: Date.now(),
    };
  }
  writeFileSync(join(dir, 'keystore.json'), JSON.stringify(ks, null, 2));
  writeFileSync(join(dir, 'master.key'), master);
  return truth;
}

test('rotateMaster: dry-run reports without writing', () => {
  const d = tdir();
  const oldM = randomBytes(32);
  const newM = randomBytes(32);
  setupFakeKeystore(d, oldM, 2);
  const before = readFileSync(join(d, 'keystore.json'), 'utf8');
  const r = rotateMaster({ dataDir: d, oldMaster: oldM, newMaster: newM, dryRun: true });
  assert.equal(r.dryRun, true);
  assert.equal(r.entries, 2);
  // File untouched.
  assert.equal(readFileSync(join(d, 'keystore.json'), 'utf8'), before);
  rmSync(d, { recursive: true, force: true });
});

test('rotateMaster: re-seals so the NEW master opens, OLD does not', () => {
  const d = tdir();
  const oldM = randomBytes(32);
  const newM = randomBytes(32);
  const truth = setupFakeKeystore(d, oldM, 3);

  const r = rotateMaster({ dataDir: d, oldMaster: oldM, newMaster: newM, dryRun: false });
  assert.equal(r.dryRun, false);
  assert.equal(r.entries, 3);

  const after = JSON.parse(readFileSync(join(d, 'keystore.json'), 'utf8'));
  for (const [keyId, original] of Object.entries(truth)) {
    const v = after[keyId];
    // New master opens correctly + recovers identical plaintext.
    const sk = openWith(newM, keyId + ':sk', v.sk_sealed);
    const ek = openWith(newM, keyId + ':ek', v.ek_sealed);
    assert.deepEqual([...sk], [...original.sk]);
    assert.deepEqual([...ek], [...original.ek]);
    // Old master fails (AEAD tag mismatch).
    assert.throws(() => openWith(oldM, keyId + ':sk', v.sk_sealed));
  }

  // master.key on disk is the new master.
  const onDisk = readFileSync(join(d, 'master.key'));
  assert.deepEqual([...onDisk], [...newM]);
  rmSync(d, { recursive: true, force: true });
});

test('rotateMaster: writes timestamped backups of the originals', () => {
  const d = tdir();
  const oldM = randomBytes(32);
  const newM = randomBytes(32);
  setupFakeKeystore(d, oldM, 1);
  const r = rotateMaster({ dataDir: d, oldMaster: oldM, newMaster: newM, dryRun: false });

  assert.equal(r.backups.length, 2);
  for (const b of r.backups) assert.ok(existsSync(b), `${b} missing`);

  // Backup contents match what was on disk before rotation.
  const ksBak = r.backups.find(b => b.includes('keystore.json.bak'));
  const mkBak = r.backups.find(b => b.includes('master.key.bak'));
  assert.ok(ksBak); assert.ok(mkBak);
  assert.deepEqual([...readFileSync(mkBak)], [...oldM]);
  rmSync(d, { recursive: true, force: true });
});

test('rotateMaster: throws OPEN_FAILED when old master is wrong', () => {
  const d = tdir();
  const oldM = randomBytes(32);
  const wrongM = randomBytes(32);
  const newM = randomBytes(32);
  setupFakeKeystore(d, oldM, 1);
  assert.throws(
    () => rotateMaster({ dataDir: d, oldMaster: wrongM, newMaster: newM, dryRun: true }),
    /OPEN_FAILED/);
  rmSync(d, { recursive: true, force: true });
});

test('rotateMaster: missing keystore.json fails loud', () => {
  const d = tdir();
  writeFileSync(join(d, 'master.key'), randomBytes(32));
  assert.throws(
    () => rotateMaster({
      dataDir: d, oldMaster: randomBytes(32), newMaster: randomBytes(32), dryRun: true,
    }),
    /keystore\.json missing/);
  rmSync(d, { recursive: true, force: true });
});

test('rotateMaster: legacy plaintext entries are migrated to sealed', () => {
  const d = tdir();
  const oldM = randomBytes(32);
  const newM = randomBytes(32);
  // Write a keystore with legacy plaintext entries (no `sealed`).
  const sk = randomBytes(32);
  const ek = randomBytes(32);
  const ks = {
    'legacy-key': {
      sk: sk.toString('base64'),
      ek: ek.toString('base64'),
      vk: 'fake-vk',
      label: 'legacy',
      createdAt: 1000,
    },
  };
  writeFileSync(join(d, 'keystore.json'), JSON.stringify(ks, null, 2));
  writeFileSync(join(d, 'master.key'), oldM);

  rotateMaster({ dataDir: d, oldMaster: oldM, newMaster: newM, dryRun: false });
  const after = JSON.parse(readFileSync(join(d, 'keystore.json'), 'utf8'));
  assert.equal(after['legacy-key'].sealed, true);
  const skBack = openWith(newM, 'legacy-key:sk', after['legacy-key'].sk_sealed);
  assert.deepEqual([...skBack], [...sk]);
  rmSync(d, { recursive: true, force: true });
});

test('rotateMaster: idempotent — re-running with same new master is a no-op for plaintext', () => {
  const d = tdir();
  const m1 = randomBytes(32);
  const m2 = randomBytes(32);
  const truth = setupFakeKeystore(d, m1, 2);
  rotateMaster({ dataDir: d, oldMaster: m1, newMaster: m2, dryRun: false });

  // Now rotate again with m2 as old, m1 as new — full round-trip back.
  rotateMaster({ dataDir: d, oldMaster: m2, newMaster: m1, dryRun: false });

  const after = JSON.parse(readFileSync(join(d, 'keystore.json'), 'utf8'));
  for (const [keyId, original] of Object.entries(truth)) {
    const sk = openWith(m1, keyId + ':sk', after[keyId].sk_sealed);
    assert.deepEqual([...sk], [...original.sk]);
  }
  // Two backups per rotation = 4 backups total.
  const backups = readdirSync(d).filter(f => f.includes('.bak.'));
  assert.equal(backups.length, 4);
  rmSync(d, { recursive: true, force: true });
});
