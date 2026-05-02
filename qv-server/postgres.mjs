// postgres.mjs — minimal zero-dep PostgreSQL frontend protocol client.
//
// Why this exists
// ----------------
// The Sigvault server has a zero-npm-dependency oath. Pulling `pg` (or
// any of its competitors) breaks that oath and reintroduces the
// supply-chain risk that the dep-audit gate was created to prevent. We
// instead implement just enough of the Postgres wire protocol (frontend
// message format v3.0, AKA "extended query protocol") to support the
// `chain-store-postgres.mjs` use case:
//
//   - TCP connect (no SSL — operator terminates TLS upstream or runs PG
//     on a private network; same posture as qv-server's HTTP).
//   - Startup with parameters (user, database).
//   - Authentication: SCRAM-SHA-256 (modern PG ≥10 default) and
//     `cleartext` (for ad-hoc dev/test setups). MD5 is deliberately
//     unsupported — it's deprecated and adding it would be a regression.
//   - Simple query (Q) for one-shot SQL.
//   - Extended query (Parse / Bind / Execute / Sync) with parameters.
//   - Text-format parameters and results (no binary marshalling).
//   - Transactions via simple-query BEGIN / COMMIT / ROLLBACK.
//   - Errors surface as { code, message, severity } objects.
//
// What this is NOT
// ----------------
//   - Not a connection pool. ChainStore is single-writer per process.
//   - Not COPY. We don't need bulk loading.
//   - Not LISTEN/NOTIFY.
//   - Not prepared statement cache.
//   - Not a pg-typed driver. Everything is text → caller parses ints,
//     bytea (hex format `\x...`), bigint, etc.
//
// References
// ----------
// PostgreSQL message format reference:
//   https://www.postgresql.org/docs/current/protocol-message-formats.html
// SCRAM-SHA-256 (RFC 5802 / 7677):
//   https://datatracker.ietf.org/doc/html/rfc7677
//
// Zero deps. Node stdlib only (`node:net`, `node:crypto`).

import net from 'node:net';
import {
  randomBytes, createHash, createHmac, pbkdf2Sync, timingSafeEqual,
} from 'node:crypto';

const PROTOCOL_3_0 = (3 << 16) | 0;

/**
 * Connect, authenticate, and return a ready client.
 *
 * @param {object} opts
 * @param {string} opts.host
 * @param {number} opts.port
 * @param {string} opts.user
 * @param {string} opts.password
 * @param {string} opts.database
 * @param {string} [opts.applicationName='sigvault-server']
 * @param {number} [opts.connectTimeoutMs=8000]
 * @param {number} [opts.queryTimeoutMs=30000]
 * @returns {Promise<PgClient>}
 */
export async function connect(opts) {
  const sock = net.connect({ host: opts.host, port: opts.port });
  // No naïve setNoDelay — let the OS batch our small messages.
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => {
      sock.destroy(); reject(new Error(`PG_CONNECT_TIMEOUT ${opts.host}:${opts.port}`));
    }, opts.connectTimeoutMs ?? 8000);
    sock.once('connect', () => { clearTimeout(to); resolve(); });
    sock.once('error', (e) => { clearTimeout(to); reject(e); });
  });
  const c = new PgClient(sock, opts);
  await c._handshake();
  return c;
}

class PgClient {
  constructor(sock, opts) {
    this.sock = sock;
    this.opts = opts;
    this.buf  = Buffer.alloc(0);
    this.queue = [];   // pending message resolvers
    this.parameters = {};   // server-side runtime params
    this.txStatus = 'I';    // 'I'=idle, 'T'=in tx, 'E'=tx error
    this.closed = false;
    this.fatalError = null;

    sock.on('data', (chunk) => this._onData(chunk));
    sock.on('error', (e) => this._fatal(e));
    sock.on('close', () => this._fatal(new Error('PG_SOCKET_CLOSED')));
  }

  _fatal(err) {
    this.fatalError = err;
    this.closed = true;
    while (this.queue.length) {
      const w = this.queue.shift();
      try { w.reject(err); } catch {}
    }
  }

  _onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 5) {
      const tag = this.buf.readUInt8(0);
      const len = this.buf.readUInt32BE(1);
      if (this.buf.length < 1 + len) break;
      const payload = this.buf.subarray(5, 1 + len);
      this.buf = this.buf.subarray(1 + len);
      this._dispatch(tag, payload);
    }
  }

  _dispatch(tag, payload) {
    const w = this.queue[0];
    if (!w) return; // unsolicited message — most are runtime params
    try {
      const done = w.onMessage(tag, payload);
      if (done) {
        this.queue.shift();
        w.resolve(done);
      }
    } catch (e) {
      this.queue.shift();
      w.reject(e);
    }
  }

  _send(tag, body) {
    // Body length includes its own 4-byte length field.
    const total = (tag === null) ? body.length + 4 : body.length + 5;
    const out = Buffer.alloc(total);
    let off = 0;
    if (tag !== null) {
      out.writeUInt8(tag.charCodeAt(0), off); off += 1;
    }
    out.writeUInt32BE(total - (tag === null ? 0 : 1), off); off += 4;
    body.copy(out, off);
    this.sock.write(out);
  }

  _enqueue(handler, timeoutMs) {
    if (this.fatalError) return Promise.reject(this.fatalError);
    return new Promise((resolve, reject) => {
      const to = (timeoutMs ?? this.opts.queryTimeoutMs ?? 30000);
      const timer = setTimeout(() => {
        // Best-effort: kill the socket; the remaining queue rejects via _fatal.
        this._fatal(new Error('PG_QUERY_TIMEOUT'));
      }, to);
      timer.unref?.();
      this.queue.push({
        onMessage: handler,
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject:  (e) => { clearTimeout(timer); reject(e); },
      });
    });
  }

  async _handshake() {
    // StartupMessage — no leading tag (special).
    const params = [
      'user',     this.opts.user,
      'database', this.opts.database || this.opts.user,
      'application_name', this.opts.applicationName || 'sigvault-server',
      'client_encoding', 'UTF8',
    ];
    const blocks = params.map(s => Buffer.from(s + '\0', 'utf8'));
    blocks.push(Buffer.from([0])); // terminator
    const body = Buffer.concat([
      Buffer.from([0, 3, 0, 0]),         // protocol 3.0
      ...blocks,
    ]);
    // No tag — total length includes the 4-byte length itself.
    const startup = Buffer.alloc(body.length + 4);
    startup.writeUInt32BE(body.length + 4, 0);
    body.copy(startup, 4);
    this.sock.write(startup);

    // Run auth + parameter ingestion until we see ReadyForQuery.
    await this._authenticate();
  }

  async _authenticate() {
    let scramState = null;

    return this._enqueue((tag, p) => {
      switch (String.fromCharCode(tag)) {
        case 'R': {
          const subType = p.readUInt32BE(0);
          if (subType === 0) {           // AuthenticationOk
            return false; // wait for ParameterStatus + ReadyForQuery
          }
          if (subType === 3) {           // AuthenticationCleartextPassword
            const body = Buffer.concat([Buffer.from(this.opts.password + '\0', 'utf8')]);
            this._send('p', body);
            return false;
          }
          if (subType === 10) {          // AuthenticationSASL — must include SCRAM-SHA-256
            // Server-advertised mechanisms come as cstrings until \0\0.
            let off = 4;
            const mechs = [];
            while (true) {
              const end = p.indexOf(0, off);
              if (end === off) break;
              mechs.push(p.subarray(off, end).toString('utf8'));
              off = end + 1;
            }
            if (!mechs.includes('SCRAM-SHA-256')) {
              throw new Error(`PG_AUTH_UNSUPPORTED: server mechanisms = ${mechs.join(',')}`);
            }
            // Client first message.
            const cnonce = randomBytes(18).toString('base64');
            const clientFirstBare = `n=,r=${cnonce}`;
            const clientFirst     = `n,,${clientFirstBare}`;
            scramState = { cnonce, clientFirstBare, password: this.opts.password };
            const mech = Buffer.from('SCRAM-SHA-256\0', 'utf8');
            const cf   = Buffer.from(clientFirst, 'utf8');
            const len  = Buffer.alloc(4);
            len.writeUInt32BE(cf.length, 0);
            this._send('p', Buffer.concat([mech, len, cf]));
            return false;
          }
          if (subType === 11) {          // AuthenticationSASLContinue
            const serverFirst = p.subarray(4).toString('utf8');
            // Parse: r=...,s=...,i=...
            const parts = Object.fromEntries(serverFirst.split(',').map(kv => {
              const i = kv.indexOf('=');
              return [kv.slice(0, i), kv.slice(i + 1)];
            }));
            if (!parts.r.startsWith(scramState.cnonce)) {
              throw new Error('PG_SCRAM_BAD_NONCE');
            }
            const salt = Buffer.from(parts.s, 'base64');
            const iter = Number(parts.i);
            const saltedPassword = pbkdf2Sync(scramState.password, salt, iter, 32, 'sha256');
            const clientKey = createHmac('sha256', saltedPassword).update('Client Key').digest();
            const storedKey = createHash('sha256').update(clientKey).digest();
            const channelBinding = Buffer.from('biws', 'utf8'); // base64('n,,')
            const clientFinalNoProof = `c=${channelBinding},r=${parts.r}`;
            const authMessage = `${scramState.clientFirstBare},${serverFirst},${clientFinalNoProof}`;
            const clientSig  = createHmac('sha256', storedKey).update(authMessage).digest();
            const proof = Buffer.alloc(32);
            for (let i = 0; i < 32; i++) proof[i] = clientKey[i] ^ clientSig[i];
            const clientFinal = `${clientFinalNoProof},p=${proof.toString('base64')}`;
            scramState.serverKey   = createHmac('sha256', saltedPassword).update('Server Key').digest();
            scramState.authMessage = authMessage;
            this._send('p', Buffer.from(clientFinal, 'utf8'));
            return false;
          }
          if (subType === 12) {          // AuthenticationSASLFinal
            const final = p.subarray(4).toString('utf8');
            const v = final.split(',').find(kv => kv.startsWith('v=')).slice(2);
            const expected = createHmac('sha256', scramState.serverKey)
              .update(scramState.authMessage).digest();
            const got = Buffer.from(v, 'base64');
            if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
              throw new Error('PG_SCRAM_SERVER_PROOF_MISMATCH');
            }
            return false;
          }
          throw new Error(`PG_AUTH_UNKNOWN_SUBTYPE: ${subType}`);
        }
        case 'S': {                       // ParameterStatus
          const i = p.indexOf(0);
          const j = p.indexOf(0, i + 1);
          const k = p.subarray(0, i).toString('utf8');
          const v = p.subarray(i + 1, j).toString('utf8');
          this.parameters[k] = v;
          return false;
        }
        case 'K': {                       // BackendKeyData (ignored)
          return false;
        }
        case 'Z': {                       // ReadyForQuery
          this.txStatus = String.fromCharCode(p.readUInt8(0));
          return true;
        }
        case 'E': {                       // ErrorResponse
          throw decodeError(p);
        }
        case 'N':                         // NoticeResponse — ignore
          return false;
        default:
          throw new Error(`PG_UNEXPECTED_TAG_DURING_AUTH: ${String.fromCharCode(tag)}`);
      }
    });
  }

  /**
   * Run a SQL string (no parameters) and return all rows as
   * arrays-of-strings (text format).
   *
   * Returns: { rows: string[][], columns: string[], command: string }
   */
  async query(sql) {
    if (this.closed) throw new Error('PG_CLOSED');
    this._send('Q', Buffer.from(sql + '\0', 'utf8'));
    return this._collectResults();
  }

  /**
   * Extended-query path with parameters. Parameters are sent as text
   * values; numbers / bigints / strings are str()d, Buffers become a
   * `\x<hex>` literal (Postgres bytea).
   */
  async exec(sql, params = []) {
    if (this.closed) throw new Error('PG_CLOSED');
    // Parse — unnamed statement.
    {
      const stmtName = '\0';                                 // unnamed
      const sqlz     = Buffer.from(sql + '\0', 'utf8');
      const nParams  = Buffer.alloc(2);                      // 0 — no specific OIDs
      nParams.writeUInt16BE(0, 0);
      this._send('P', Buffer.concat([Buffer.from(stmtName, 'utf8'), sqlz, nParams]));
    }
    // Bind — unnamed portal, unnamed statement.
    {
      const portal   = Buffer.from('\0', 'utf8');
      const stmt     = Buffer.from('\0', 'utf8');
      const nFmt     = Buffer.alloc(2);
      nFmt.writeUInt16BE(0, 0); // all params text
      const nP       = Buffer.alloc(2);
      nP.writeUInt16BE(params.length, 0);
      const paramBlocks = [];
      for (const p of params) {
        if (p === null || p === undefined) {
          const len = Buffer.alloc(4); len.writeInt32BE(-1, 0);
          paramBlocks.push(len);
          continue;
        }
        let str;
        if (Buffer.isBuffer(p))      str = '\\x' + p.toString('hex');
        else if (typeof p === 'bigint') str = p.toString();
        else if (typeof p === 'number') str = String(p);
        else                            str = String(p);
        const b = Buffer.from(str, 'utf8');
        const len = Buffer.alloc(4); len.writeUInt32BE(b.length, 0);
        paramBlocks.push(len);
        paramBlocks.push(b);
      }
      const nResFmt = Buffer.alloc(2); nResFmt.writeUInt16BE(0, 0); // text results
      this._send('B', Buffer.concat([portal, stmt, nFmt, nP, ...paramBlocks, nResFmt]));
    }
    // Execute — unnamed portal, no row limit.
    {
      const portal = Buffer.from('\0', 'utf8');
      const limit  = Buffer.alloc(4); limit.writeUInt32BE(0, 0);
      this._send('E', Buffer.concat([portal, limit]));
    }
    // Sync — flushes everything and forces a ReadyForQuery.
    this._send('S', Buffer.alloc(0));

    return this._collectResults({ extended: true });
  }

  /**
   * Drives the message stream from the server until ReadyForQuery and
   * returns the result.
   */
  _collectResults({ extended = false } = {}) {
    const result = { rows: [], columns: [], command: null };
    let pendingError = null;

    return this._enqueue((tag, p) => {
      switch (String.fromCharCode(tag)) {
        case 'T': {                       // RowDescription
          const n = p.readUInt16BE(0);
          let off = 2;
          for (let i = 0; i < n; i++) {
            const end = p.indexOf(0, off);
            const name = p.subarray(off, end).toString('utf8');
            // Skip the 18 trailing bytes per field (oid, attno, type, etc.)
            off = end + 1 + 18;
            result.columns.push(name);
          }
          return false;
        }
        case 'D': {                       // DataRow
          const n = p.readUInt16BE(0);
          let off = 2;
          const row = new Array(n);
          for (let i = 0; i < n; i++) {
            const len = p.readInt32BE(off);
            off += 4;
            if (len === -1) { row[i] = null; continue; }
            row[i] = p.subarray(off, off + len).toString('utf8');
            off += len;
          }
          result.rows.push(row);
          return false;
        }
        case 'C': {                       // CommandComplete
          const end = p.indexOf(0);
          result.command = p.subarray(0, end).toString('utf8');
          return false;
        }
        case 'I':                         // EmptyQueryResponse
        case 'n':                         // NoData (extended)
        case '1':                         // ParseComplete
        case '2':                         // BindComplete
        case 's':                         // PortalSuspended (we never send a row limit)
          return false;
        case 'Z': {                       // ReadyForQuery
          this.txStatus = String.fromCharCode(p.readUInt8(0));
          if (pendingError) throw pendingError;
          return result;
        }
        case 'E': {
          pendingError = decodeError(p);
          // For simple Q, ReadyForQuery follows directly. For extended,
          // Postgres still sends ReadyForQuery after Sync — we keep
          // consuming until we see it.
          return false;
        }
        case 'N':                         // NoticeResponse — log + continue
          return false;
        case 'S': {                       // ParameterStatus mid-stream
          return false;
        }
        default:
          throw new Error(`PG_UNEXPECTED_TAG: ${String.fromCharCode(tag)}`);
      }
    });
  }

  async begin()    { await this.query('BEGIN'); }
  async commit()   { await this.query('COMMIT'); }
  async rollback() { await this.query('ROLLBACK').catch(() => {}); }

  async transaction(fn) {
    await this.begin();
    try {
      const r = await fn(this);
      await this.commit();
      return r;
    } catch (e) {
      await this.rollback();
      throw e;
    }
  }

  end() {
    if (this.closed) return;
    try { this._send('X', Buffer.alloc(0)); } catch {}
    this.closed = true;
    this.sock.end();
  }
}

/**
 * Decode an ErrorResponse / NoticeResponse body. Each field is a
 * one-byte tag followed by a c-string; the message ends with a 0-tag.
 */
export function decodeError(p) {
  const out = { code: '', message: '', severity: '', detail: '', hint: '' };
  let off = 0;
  while (off < p.length) {
    const tag = p.readUInt8(off); off += 1;
    if (tag === 0) break;
    const end = p.indexOf(0, off);
    const val = p.subarray(off, end).toString('utf8');
    off = end + 1;
    if (tag === 0x53) out.severity = val; // S
    else if (tag === 0x43) out.code = val;     // C
    else if (tag === 0x4d) out.message = val;  // M
    else if (tag === 0x44) out.detail = val;   // D
    else if (tag === 0x48) out.hint = val;     // H
  }
  // Compose the Error LAST and copy fields explicitly. `Object.assign(e, out)`
  // would clobber e.message with the unwrapped PG message, and the test
  // suite — plus every caller that branches on the prefix — depends on
  // the `PG_<code>: ...` shape.
  const composed = `PG_${out.code || 'ERROR'}: ${out.message}`;
  const e = new Error(composed);
  e.code        = `PG_${out.code || 'ERROR'}`;
  e.pgCode      = out.code;
  e.pgSeverity  = out.severity;
  e.pgMessage   = out.message;
  e.pgDetail    = out.detail;
  e.pgHint      = out.hint;
  return e;
}

/**
 * Parse a Postgres bytea text-format value (`\x<hex>` or escape-form)
 * into a Buffer. Supports modern hex format only — operator-side bytea
 * is always written via parameter binding which we serialise in hex.
 */
export function parseBytea(s) {
  if (typeof s !== 'string') return null;
  if (s.startsWith('\\x')) return Buffer.from(s.slice(2), 'hex');
  // Fallback: escape-format (rare in modern PG). Caller should set
  // bytea_output=hex on the server.
  throw new Error('PG_BYTEA_ESCAPE_UNSUPPORTED — set bytea_output=hex');
}
