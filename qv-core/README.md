# qv-core

The Rust core of [Sigvault](https://github.com/007krcs/quantum-vault) —
post-quantum cryptographic tokens that are quantum-safe, authenticated,
encrypted, and replay-protected.

```toml
[dependencies]
qv-core = { version = "4.2", features = ["falcon"] }
```

## What you get

| Primitive | Algorithm | Size |
|---|---|---:|
| Signature (default) | **ML-DSA-87** (Dilithium-5, NIST FIPS 204) | 4 627 B |
| Signature (Falcon-512) | **Falcon-512** (PQClean, NIST FIPS 206 draft) | ≤ 666 B |
| Signature (Falcon-1024) | **Falcon-1024** | ≤ 1 280 B |
| AEAD | **XChaCha20-Poly1305** | 24 B nonce |
| Hash | **SHA3-256** | 32 B |
| Replay protection | **HYDRA mutation chain** (stateful) | 8 B counter |

## Issuing a token

```rust
use qv_core::{
    Claims, IssueParams, MutationChain, SuiteId, TokenType,
    generate_keypair, issue_token, verify_token,
};

let (sk, vk) = generate_keypair()?;
let encrypt_key = [0xAB; 32];
let mut chain = MutationChain::new([0; 32]);

let mut claims = Claims::new();
claims.insert("sub", "user-123");
claims.insert("role", "admin");

let token = issue_token(IssueParams {
    suite: SuiteId::Dilithium5,
    token_type: TokenType::Access,
    ttl_secs: 3600,
    device_fp: None,
    claims: &claims,
    signing_key: &sk,
    encrypt_key: &encrypt_key,
    chain: &mut chain,
})?;

let bytes = token.to_bytes();           // wire format
```

## Verifying

```rust
let parsed = qv_core::QVRawToken::from_bytes(&bytes)?;
let verify_chain = MutationChain::from_state([0; 32], 0);
let out = verify_token(&parsed, &vk, &encrypt_key, &verify_chain)?;

assert_eq!(out.claims.get("sub"), Some("user-123"));
```

## Falcon

Falcon-512 signatures are **7.1× smaller than ML-DSA-87** and verify roughly
6× faster. Enable the `falcon` feature (on by default) and use the dedicated
entry points:

```rust
use qv_core::{
    falcon::falcon512, issue_token_falcon512, verify_token_falcon512,
};

let (sk, vk) = falcon512::generate_keypair()?;
let token = issue_token_falcon512(
    TokenType::Access, 3600, None, &claims, &sk, &encrypt_key, &mut chain,
)?;
```

The `falcon` feature links PQClean via `cc`, so it requires a C toolchain.
For `wasm32-unknown-unknown` and other targets without a C compiler, build
with `default-features = false` for ML-DSA-only.

## 7-layer verification pipeline

Every `verify_token` call runs:

1. **Structural** — MAGIC / VERSION / SUITE
2. **Entropy** — KOLMOGOROV compression-ratio check on the nonce
3. **Temporal** — not yet valid / expired
4. **Signature** — ML-DSA-87 or Falcon, depending on suite
5. **Decryption** — XChaCha20-Poly1305 AEAD
6. **Replay** — mutation-chain counter monotonicity
7. **Claims** — MessagePack-subset well-formedness

## License

Apache-2.0. See [LICENSE](https://github.com/007krcs/quantum-vault/blob/main/LICENSE).
