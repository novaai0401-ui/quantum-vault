"""
QuantumVault v4.1 -- Falcon FFI Demo
=====================================
Proves Falcon-512 / Falcon-1024 via the same qv.dll, side-by-side with
ML-DSA-87. Focus: signature size (the whole point of shipping Falcon).

Run:  python demo_falcon.py
"""
import ctypes
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
DLL  = HERE.parents[2] / "target" / "release" / "qv.dll"
qv   = ctypes.CDLL(str(DLL))

# ---- prototypes -------------------------------------------------------------
for name in ("qv_abi_version",
             "qv_vk_len", "qv_sk_len", "qv_sig_len",
             "qv_falcon512_vk_len", "qv_falcon512_sk_len", "qv_falcon512_sig_max_len",
             "qv_falcon1024_vk_len", "qv_falcon1024_sk_len", "qv_falcon1024_sig_max_len"):
    getattr(qv, name).restype = ctypes.c_uint32

U8p = ctypes.c_char_p
U32 = ctypes.c_uint32

# ML-DSA-87
qv.qv_keygen.argtypes = [U8p, U32, U8p, U32]; qv.qv_keygen.restype = ctypes.c_int32
qv.qv_sign.argtypes   = [U8p, U32, U8p, U32, U8p, U32]; qv.qv_sign.restype = ctypes.c_int32
qv.qv_verify.argtypes = [U8p, U32, U8p, U32, U8p, U32]; qv.qv_verify.restype = ctypes.c_int32

# Falcon keygen: same shape
for fam in ("qv_falcon512_keygen", "qv_falcon1024_keygen"):
    getattr(qv, fam).argtypes = [U8p, U32, U8p, U32]
    getattr(qv, fam).restype  = ctypes.c_int32

# Falcon sign: extra sig_len_out pointer
for fam in ("qv_falcon512_sign", "qv_falcon1024_sign"):
    getattr(qv, fam).argtypes = [U8p, U32, U8p, U32, U8p, U32, ctypes.POINTER(U32)]
    getattr(qv, fam).restype  = ctypes.c_int32

for fam in ("qv_falcon512_verify", "qv_falcon1024_verify"):
    getattr(qv, fam).argtypes = [U8p, U32, U8p, U32, U8p, U32]
    getattr(qv, fam).restype  = ctypes.c_int32

print("\n=============================================================")
print("  QuantumVault v4.1 -- Falcon vs ML-DSA-87 (Python FFI)")
print("=============================================================")
print(f"  ABI version: {qv.qv_abi_version()}  (2 = Falcon-enabled)\n")

MSG = b"QuantumVault v4.1 -- size matters for JWT-class tokens"

def run(label, sk_len, vk_len, sig_max, keygen, sign, verify, variable_sig):
    sk  = ctypes.create_string_buffer(sk_len)
    vk  = ctypes.create_string_buffer(vk_len)
    sig = ctypes.create_string_buffer(sig_max)

    t0 = time.perf_counter()
    assert keygen(sk, sk_len, vk, vk_len) == 0, "keygen"
    kg_ms = (time.perf_counter() - t0) * 1000

    t0 = time.perf_counter()
    if variable_sig:
        out_len = U32(0)
        assert sign(sk, sk_len, MSG, len(MSG), sig, sig_max, ctypes.byref(out_len)) == 0, "sign"
        actual = out_len.value
    else:
        assert sign(sk, sk_len, MSG, len(MSG), sig, sig_max) == 0, "sign"
        actual = sig_max
    sig_ms = (time.perf_counter() - t0) * 1000

    t0 = time.perf_counter()
    assert verify(vk, vk_len, MSG, len(MSG), sig, actual) == 1, "verify"
    vrf_ms = (time.perf_counter() - t0) * 1000

    # Tamper test
    bad = bytearray(sig.raw[:actual])
    bad[10] ^= 0xFF
    assert verify(vk, vk_len, MSG, len(MSG), bytes(bad), actual) == 0, "tamper"

    # Bench
    N = 100
    t0 = time.perf_counter()
    for _ in range(N):
        verify(vk, vk_len, MSG, len(MSG), sig, actual)
    per = (time.perf_counter() - t0) * 1000 / N
    rate = 1000 / per

    print(f"  [{label}]")
    print(f"    sk={sk_len}B  vk={vk_len}B  sig={actual}B (max {sig_max}B)")
    print(f"    keygen={kg_ms:6.1f}ms  sign={sig_ms:6.1f}ms  verify={vrf_ms:6.2f}ms")
    print(f"    bench : {per:.2f} ms/verify -> {rate:.0f}/s")
    print(f"    tamper: REJECTED OK\n")
    return actual

mldsa_sig  = run("ML-DSA-87  ", qv.qv_sk_len(), qv.qv_vk_len(), qv.qv_sig_len(),
                 qv.qv_keygen, qv.qv_sign, qv.qv_verify, variable_sig=False)

falcon512_sig = run("Falcon-512 ",
                    qv.qv_falcon512_sk_len(), qv.qv_falcon512_vk_len(), qv.qv_falcon512_sig_max_len(),
                    qv.qv_falcon512_keygen, qv.qv_falcon512_sign, qv.qv_falcon512_verify,
                    variable_sig=True)

falcon1024_sig = run("Falcon-1024",
                     qv.qv_falcon1024_sk_len(), qv.qv_falcon1024_vk_len(), qv.qv_falcon1024_sig_max_len(),
                     qv.qv_falcon1024_keygen, qv.qv_falcon1024_sign, qv.qv_falcon1024_verify,
                     variable_sig=True)

print("-------------------------------------------------------------")
print(f"  Signature-size verdict:")
print(f"    ML-DSA-87    {mldsa_sig:>5} B   (baseline)")
print(f"    Falcon-512   {falcon512_sig:>5} B   ({mldsa_sig/falcon512_sig:.1f}x smaller)")
print(f"    Falcon-1024  {falcon1024_sig:>5} B   ({mldsa_sig/falcon1024_sig:.1f}x smaller)")
print("=============================================================\n")
