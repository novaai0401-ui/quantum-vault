import { useState } from 'react';
import {
  TkxTabs, TkxTabList, TkxTab, TkxTabPanel, TkxAlert, TkxBadge,
} from 'tekivex-ui';

type Lang = 'python' | 'c' | 'go' | 'csharp' | 'node-wasm' | 'js-rest';

export default function Languages() {
  const [lang, setLang] = useState<Lang>('python');

  return (
    <>
      <h1>Use it from any language</h1>
      <p className="lead">
        Every example below calls the same Rust core — either directly via
        the C ABI shared library, via the portable WASM module, or via the
        REST server. Pick a tab for the pattern in your language.
      </p>

      <TkxAlert variant="info" title="How to read this page">
        The FFI tabs all need <code>target/release/qv.dll</code> (or
        <code> libqv.so</code> / <code>libqv.dylib</code>). Build it once
        with <code>cargo build -p qv-ffi --release</code> and the same
        binary serves Python, Go, C, C#, Java, Ruby, Swift, and anything
        else that can load a shared library.
      </TkxAlert>

      <TkxTabs
        value={lang}
        onChange={(v: string) => setLang(v as Lang)}
        style={{ marginTop: 20 }}
      >
        <TkxTabList>
          <TkxTab value="python">Python · FFI</TkxTab>
          <TkxTab value="c">C · FFI</TkxTab>
          <TkxTab value="go">Go · cgo</TkxTab>
          <TkxTab value="csharp">C# / .NET · P/Invoke</TkxTab>
          <TkxTab value="node-wasm">Node / Browser · WASM</TkxTab>
          <TkxTab value="js-rest">JS · REST</TkxTab>
        </TkxTabList>

        <TkxTabPanel value="python"><PyPanel /></TkxTabPanel>
        <TkxTabPanel value="c"><CPanel /></TkxTabPanel>
        <TkxTabPanel value="go"><GoPanel /></TkxTabPanel>
        <TkxTabPanel value="csharp"><CSharpPanel /></TkxTabPanel>
        <TkxTabPanel value="node-wasm"><WasmPanel /></TkxTabPanel>
        <TkxTabPanel value="js-rest"><JsRestPanel /></TkxTabPanel>
      </TkxTabs>

      <h2>Suite matrix</h2>
      <table>
        <thead>
          <tr>
            <th>Suite</th>
            <th>Signature (max)</th>
            <th>Verify key</th>
            <th>Status</th>
            <th>Best for</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><b>ML-DSA-87</b></td>
            <td>4627 B (fixed)</td>
            <td>2592 B</td>
            <td><TkxBadge size="sm" colorScheme="success">shipped</TkxBadge></td>
            <td>Default · 192-bit PQ · long-lived tokens</td>
          </tr>
          <tr>
            <td><b>Falcon-512</b></td>
            <td>666 B (variable)</td>
            <td>897 B</td>
            <td><TkxBadge size="sm" colorScheme="success">shipped</TkxBadge></td>
            <td>JWT-class size · 64-bit PQ · cookies</td>
          </tr>
          <tr>
            <td><b>Falcon-1024</b></td>
            <td>1280 B (variable)</td>
            <td>1793 B</td>
            <td><TkxBadge size="sm" colorScheme="success">shipped</TkxBadge></td>
            <td>Size + 192-bit PQ · the sweet spot</td>
          </tr>
          <tr>
            <td>ML-DSA-44 / 65</td>
            <td>—</td>
            <td>—</td>
            <td><TkxBadge size="sm" variant="outline">reserved</TkxBadge></td>
            <td>Future suites · IDs 0x02 / 0x03 allocated</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

const P = ({ children }: { children: React.ReactNode }) => (
  <pre><code>{children}</code></pre>
);

function PyPanel() {
  return (
    <>
      <h3>Python — <code>ctypes</code>, no pip</h3>
      <p>No third-party packages. <code>ctypes</code> ships with Python.</p>
      <P>{`import ctypes, time

qv = ctypes.CDLL("target/release/qv.dll")   # or libqv.so / libqv.dylib

qv.qv_vk_len.restype  = ctypes.c_uint32
qv.qv_sk_len.restype  = ctypes.c_uint32
qv.qv_sig_len.restype = ctypes.c_uint32
SK, VK, SIG = qv.qv_sk_len(), qv.qv_vk_len(), qv.qv_sig_len()

qv.qv_keygen.argtypes = [ctypes.c_char_p, ctypes.c_uint32,
                         ctypes.c_char_p, ctypes.c_uint32]
qv.qv_keygen.restype  = ctypes.c_int32
qv.qv_sign.argtypes   = [ctypes.c_char_p, ctypes.c_uint32]*3
qv.qv_sign.restype    = ctypes.c_int32
qv.qv_verify.argtypes = [ctypes.c_char_p, ctypes.c_uint32]*3
qv.qv_verify.restype  = ctypes.c_int32

sk = ctypes.create_string_buffer(SK)
vk = ctypes.create_string_buffer(VK)
assert qv.qv_keygen(sk, SK, vk, VK) == 0

msg = b"hello post-quantum"
sig = ctypes.create_string_buffer(SIG)
assert qv.qv_sign(sk, SK, msg, len(msg), sig, SIG) == 0
assert qv.qv_verify(vk, VK, msg, len(msg), sig, SIG) == 1
print("verified ✓")`}</P>
      <p>For Falcon (smaller sigs) see
        <code> qv-ffi/examples/python/demo_falcon.py</code>.</p>
    </>
  );
}

function CPanel() {
  return (
    <>
      <h3>C — plain <code>#include &quot;qv.h&quot;</code></h3>
      <P>{`#include <stdio.h>
#include <string.h>
#include "qv.h"

int main(void) {
    uint8_t sk[32], vk[2592], sig[4627];
    if (qv_keygen(sk, 32, vk, 2592) != 0) return 1;

    const char *msg = "hello post-quantum";
    uint32_t mlen = (uint32_t)strlen(msg);
    if (qv_sign(sk, 32, (const uint8_t*)msg, mlen, sig, 4627) != 0) return 2;

    int ok = qv_verify(vk, 2592, (const uint8_t*)msg, mlen, sig, 4627);
    printf("verify = %d\\n", ok);
    return ok == 1 ? 0 : 3;
}`}</P>
      <P>{`# build
gcc demo.c -Iqv-ffi/include -Ltarget/release -lqv -o demo

# run (Windows: copy qv.dll next to demo.exe first)
./demo`}</P>
    </>
  );
}

function GoPanel() {
  return (
    <>
      <h3>Go — cgo</h3>
      <P>{`package main

/*
#cgo LDFLAGS: -L${PROJECT_ROOT}/target/release -lqv
#include "qv.h"
*/
import "C"
import (
    "fmt"
    "unsafe"
)

func main() {
    sk := make([]byte, 32)
    vk := make([]byte, 2592)
    C.qv_keygen((*C.uint8_t)(unsafe.Pointer(&sk[0])), 32,
                (*C.uint8_t)(unsafe.Pointer(&vk[0])), 2592)

    msg := []byte("hello post-quantum")
    sig := make([]byte, 4627)
    C.qv_sign((*C.uint8_t)(unsafe.Pointer(&sk[0])), 32,
              (*C.uint8_t)(unsafe.Pointer(&msg[0])), C.uint32_t(len(msg)),
              (*C.uint8_t)(unsafe.Pointer(&sig[0])), 4627)

    ok := C.qv_verify((*C.uint8_t)(unsafe.Pointer(&vk[0])), 2592,
                       (*C.uint8_t)(unsafe.Pointer(&msg[0])), C.uint32_t(len(msg)),
                       (*C.uint8_t)(unsafe.Pointer(&sig[0])), 4627)
    fmt.Println("verify =", ok)
}`}</P>
      <p>Full file at <code>qv-ffi/examples/go/demo.go</code>.</p>
    </>
  );
}

function CSharpPanel() {
  return (
    <>
      <h3>C# / .NET — P/Invoke</h3>
      <P>{`using System;
using System.Runtime.InteropServices;

class Qv {
    [DllImport("qv")] static extern int  qv_keygen(byte[] sk, uint skLen, byte[] vk, uint vkLen);
    [DllImport("qv")] static extern int  qv_sign  (byte[] sk, uint skLen,
                                                    byte[] msg, uint msgLen,
                                                    byte[] sig, uint sigCap);
    [DllImport("qv")] static extern int  qv_verify(byte[] vk, uint vkLen,
                                                    byte[] msg, uint msgLen,
                                                    byte[] sig, uint sigLen);

    static void Main() {
        var sk = new byte[32]; var vk = new byte[2592]; var sig = new byte[4627];
        qv_keygen(sk, 32, vk, 2592);

        var msg = System.Text.Encoding.UTF8.GetBytes("hello post-quantum");
        qv_sign(sk, 32, msg, (uint)msg.Length, sig, 4627);

        int ok = qv_verify(vk, 2592, msg, (uint)msg.Length, sig, 4627);
        Console.WriteLine($"verify = {ok}");
    }
}`}</P>
      <p>Full file at <code>qv-ffi/examples/csharp/Demo.cs</code>.</p>
    </>
  );
}

function WasmPanel() {
  return (
    <>
      <h3>WebAssembly — Node, browser, Deno, Cloudflare Workers</h3>
      <p>
        The WASM module declares exactly one host import:{' '}
        <code>qv_host_random(ptr, len) -&gt; i32</code>. Wire it to your
        platform's CSPRNG and you're done.
      </p>
      <P>{`import { readFileSync } from 'node:fs';
import { randomFillSync } from 'node:crypto';

const bytes = readFileSync('target/wasm32-unknown-unknown/release/qv_wasm.wasm');

let memory;
const imports = {
  env: {
    qv_host_random: (ptr, len) => {
      randomFillSync(new Uint8Array(memory.buffer, ptr, len));
      return 0;
    },
  },
};

const mod = await WebAssembly.instantiate(bytes, imports);
const ex  = mod.instance.exports;
memory    = ex.memory;

const SK = ex.qv_wasm_sk_len(), VK = ex.qv_wasm_vk_len(), SIG = ex.qv_wasm_sig_len();
const skPtr = ex.qv_wasm_alloc(SK), vkPtr = ex.qv_wasm_alloc(VK);
ex.qv_wasm_keygen(skPtr, vkPtr);

const msg = new TextEncoder().encode('hello post-quantum');
const msgPtr = ex.qv_wasm_alloc(msg.length);
new Uint8Array(memory.buffer, msgPtr, msg.length).set(msg);

const sigPtr = ex.qv_wasm_alloc(SIG);
ex.qv_wasm_sign(skPtr, SK, msgPtr, msg.length, sigPtr);
console.log('verify =', ex.qv_wasm_verify(vkPtr, VK, msgPtr, msg.length, sigPtr, SIG));`}</P>
      <p>Full file at <code>qv-wasm/demo-node.mjs</code>. For the browser,
        substitute <code>crypto.getRandomValues</code> for the
        <code> randomFillSync</code> call.</p>
    </>
  );
}

function JsRestPanel() {
  return (
    <>
      <h3>JavaScript — via the REST server</h3>
      <P>{`const BASE = 'http://localhost:7433';

// 1. create a keypair
const { keyId } = await fetch(BASE + '/v3/keygen', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ label: 'demo' }),
}).then(r => r.json());

// 2. issue a token
const { tokenHex } = await fetch(BASE + '/v3/token/issue', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    keyId,
    ttl: 3600,
    claims: { sub: 'alice', role: 'admin' },
  }),
}).then(r => r.json());

// 3. verify it
const verify = await fetch(BASE + '/v3/token/verify', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ keyId, token: tokenHex }),
}).then(r => r.json());

console.log(verify);  // { valid: true, claims: {...}, mutationCtr: 1 }`}</P>
      <p>Every request is curl-friendly; see the{' '}
        <a href="/api">REST API reference</a> for the full list.</p>
    </>
  );
}
