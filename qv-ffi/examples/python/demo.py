"""
Sigvault v4.0 — Python FFI Demo
====================================
Calls qv.dll directly via ctypes (Python stdlib). NO HTTP. NO server.
NO pip packages. The DLL is the library.

Run:
    python demo.py

Requires: target/release/qv.dll on the library search path (we locate it
relative to this file, so no configuration needed).
"""
import ctypes
import os
import time
from pathlib import Path

# ── Locate qv.dll (built by: cargo build -p qv-ffi --release) ────────────────
HERE    = Path(__file__).resolve().parent
DLL_WIN = HERE.parents[2] / "target" / "release" / "qv.dll"
DLL_LIN = HERE.parents[2] / "target" / "release" / "libqv.so"
DLL_MAC = HERE.parents[2] / "target" / "release" / "libqv.dylib"

for candidate in (DLL_WIN, DLL_LIN, DLL_MAC):
    if candidate.exists():
        DLL_PATH = str(candidate)
        break
else:
    raise FileNotFoundError("qv shared library not found — run `cargo build -p qv-ffi --release`")

qv = ctypes.CDLL(DLL_PATH)

# ── Function prototypes (mirror qv.h) ────────────────────────────────────────
qv.qv_abi_version.restype = ctypes.c_uint32
qv.qv_vk_len.restype      = ctypes.c_uint32
qv.qv_sk_len.restype      = ctypes.c_uint32
qv.qv_sig_len.restype     = ctypes.c_uint32

qv.qv_keygen.argtypes = [ctypes.c_char_p, ctypes.c_uint32,
                         ctypes.c_char_p, ctypes.c_uint32]
qv.qv_keygen.restype  = ctypes.c_int32

qv.qv_sign.argtypes = [ctypes.c_char_p, ctypes.c_uint32,
                       ctypes.c_char_p, ctypes.c_uint32,
                       ctypes.c_char_p, ctypes.c_uint32]
qv.qv_sign.restype  = ctypes.c_int32

qv.qv_verify.argtypes = [ctypes.c_char_p, ctypes.c_uint32,
                         ctypes.c_char_p, ctypes.c_uint32,
                         ctypes.c_char_p, ctypes.c_uint32]
qv.qv_verify.restype  = ctypes.c_int32

SK_LEN, VK_LEN, SIG_LEN = qv.qv_sk_len(), qv.qv_vk_len(), qv.qv_sig_len()

print("\n================================================")
print("  Sigvault v4.0 -- Python FFI Demo")
print("  ctypes | NO HTTP | NO npm | NO pip")
print("================================================\n")
print(f"OK DLL        : {DLL_PATH}")
print(f"OK ABI version: {qv.qv_abi_version()}")
print(f"OK Sizes      : sk={SK_LEN}B  vk={VK_LEN}B  sig={SIG_LEN}B\n")

# ── [1] Keygen ───────────────────────────────────────────────────────────────
sk = ctypes.create_string_buffer(SK_LEN)
vk = ctypes.create_string_buffer(VK_LEN)
t0 = time.perf_counter()
rc = qv.qv_keygen(sk, SK_LEN, vk, VK_LEN)
assert rc == 0, f"keygen rc={rc}"
print(f"[1] Keygen    : {(time.perf_counter()-t0)*1000:6.1f} ms   vk[0:8]={vk.raw[:8].hex()}")

# ── [2] Sign ─────────────────────────────────────────────────────────────────
msg = b"Sigvault sovereign -- Python says hi"
sig = ctypes.create_string_buffer(SIG_LEN)
t0  = time.perf_counter()
rc  = qv.qv_sign(sk, SK_LEN, msg, len(msg), sig, SIG_LEN)
assert rc == 0, f"sign rc={rc}"
print(f"[2] Sign      : {(time.perf_counter()-t0)*1000:6.1f} ms   sig[0:8]={sig.raw[:8].hex()}")

# ── [3] Verify ───────────────────────────────────────────────────────────────
t0 = time.perf_counter()
rc = qv.qv_verify(vk, VK_LEN, msg, len(msg), sig, SIG_LEN)
assert rc == 1, f"verify rc={rc}"
print(f"[3] Verify    : {(time.perf_counter()-t0)*1000:6.1f} ms   VALID OK")

# ── [4] Tamper ───────────────────────────────────────────────────────────────
bad      = bytearray(sig.raw)
bad[100] ^= 0xFF
rc = qv.qv_verify(vk, VK_LEN, msg, len(msg), bytes(bad), SIG_LEN)
assert rc == 0, f"tampered verify rc={rc}"
print(f"[4] Tamper    :        -   REJECTED OK")

# ── [5] Bench ────────────────────────────────────────────────────────────────
N = 50
t0 = time.perf_counter()
for _ in range(N):
    qv.qv_verify(vk, VK_LEN, msg, len(msg), sig, SIG_LEN)
dur = (time.perf_counter() - t0) * 1000
print(f"[5] Bench     : {N} verifies in {dur:.1f} ms  ->  {dur/N:.2f} ms/verify  ({N/dur*1000:.0f}/s)")

print("\n================================================")
print("  Python FFI -- ALL TESTS PASSED [OK]")
print("================================================\n")
