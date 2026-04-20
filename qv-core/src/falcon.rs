//! Falcon-512 / Falcon-1024 post-quantum signatures.
//!
//! Wraps `pqcrypto-falcon` (PQClean C reference, linked via `cc`) behind a
//! narrow QV-flavoured API. Falcon is attractive because its signatures are
//! an order of magnitude smaller than ML-DSA-87:
//!
//! | Suite       | Sig (B, max) | VK (B) | SK (B) |
//! |-------------|-------------:|-------:|-------:|
//! | Falcon-512  |          666 |    897 |   1281 |
//! | Falcon-1024 |         1280 |   1793 |   2305 |
//!
//! Note: Falcon detached signatures are **variable-length** — the values
//! above are the upper bounds (`signature_bytes()`). Always transport the
//! exact byte length; zero-pad is NOT sufficient because PQClean rejects
//! trailing garbage.
//!
//! v4.1 status: core wrapper (this file) + FFI exposure. Suite adapter
//! wiring into `issue_token` / `verify_token` arrives as part of the
//! mutation-chain refactor in v4.2.

use crate::error::{QVError, QVResult};
use pqcrypto_traits::sign::{
    DetachedSignature as _, PublicKey as _, SecretKey as _, VerificationError,
};

// ─────────────────────────────────────────────────────────────────────────
// Falcon-512
// ─────────────────────────────────────────────────────────────────────────
pub mod falcon512 {
    use super::*;
    use pqcrypto_falcon::falcon512 as ffi;

    /// Max signature bytes (variable-length; use `.len()` on the returned Vec).
    pub const MAX_SIG_BYTES: usize = 666;
    pub const VK_BYTES: usize = 897;
    pub const SK_BYTES: usize = 1281;

    #[derive(Clone)]
    pub struct QVFalcon512SigningKey(ffi::SecretKey);

    #[derive(Clone)]
    pub struct QVFalcon512VerifyingKey(ffi::PublicKey);

    impl QVFalcon512SigningKey {
        pub fn to_bytes(&self) -> Vec<u8> {
            self.0.as_bytes().to_vec()
        }
        pub fn from_bytes(bytes: &[u8]) -> QVResult<Self> {
            ffi::SecretKey::from_bytes(bytes)
                .map(Self)
                .map_err(|_| QVError::SerializationError("Falcon-512 sk".into()))
        }
    }

    impl QVFalcon512VerifyingKey {
        pub fn to_bytes(&self) -> Vec<u8> {
            self.0.as_bytes().to_vec()
        }
        pub fn from_bytes(bytes: &[u8]) -> QVResult<Self> {
            ffi::PublicKey::from_bytes(bytes)
                .map(Self)
                .map_err(|_| QVError::SerializationError("Falcon-512 vk".into()))
        }
    }

    /// Generate a fresh Falcon-512 keypair.
    pub fn generate_keypair() -> QVResult<(QVFalcon512SigningKey, QVFalcon512VerifyingKey)> {
        let (pk, sk) = ffi::keypair();
        Ok((QVFalcon512SigningKey(sk), QVFalcon512VerifyingKey(pk)))
    }

    /// Produce a detached signature (variable length, up to MAX_SIG_BYTES).
    pub fn sign(sk: &QVFalcon512SigningKey, msg: &[u8]) -> QVResult<Vec<u8>> {
        let sig = ffi::detached_sign(msg, &sk.0);
        Ok(sig.as_bytes().to_vec())
    }

    /// Verify a detached signature. Returns `Ok(())` on success.
    pub fn verify(vk: &QVFalcon512VerifyingKey, msg: &[u8], sig: &[u8]) -> QVResult<()> {
        let parsed = ffi::DetachedSignature::from_bytes(sig)
            .map_err(|_| QVError::SignatureInvalid)?;
        match ffi::verify_detached_signature(&parsed, msg, &vk.0) {
            Ok(()) => Ok(()),
            Err(VerificationError::InvalidSignature) => Err(QVError::SignatureInvalid),
            Err(_) => Err(QVError::SignatureInvalid),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Falcon-1024
// ─────────────────────────────────────────────────────────────────────────
pub mod falcon1024 {
    use super::*;
    use pqcrypto_falcon::falcon1024 as ffi;

    pub const MAX_SIG_BYTES: usize = 1280;
    pub const VK_BYTES: usize = 1793;
    pub const SK_BYTES: usize = 2305;

    #[derive(Clone)]
    pub struct QVFalcon1024SigningKey(ffi::SecretKey);

    #[derive(Clone)]
    pub struct QVFalcon1024VerifyingKey(ffi::PublicKey);

    impl QVFalcon1024SigningKey {
        pub fn to_bytes(&self) -> Vec<u8> {
            self.0.as_bytes().to_vec()
        }
        pub fn from_bytes(bytes: &[u8]) -> QVResult<Self> {
            ffi::SecretKey::from_bytes(bytes)
                .map(Self)
                .map_err(|_| QVError::SerializationError("Falcon-1024 sk".into()))
        }
    }

    impl QVFalcon1024VerifyingKey {
        pub fn to_bytes(&self) -> Vec<u8> {
            self.0.as_bytes().to_vec()
        }
        pub fn from_bytes(bytes: &[u8]) -> QVResult<Self> {
            ffi::PublicKey::from_bytes(bytes)
                .map(Self)
                .map_err(|_| QVError::SerializationError("Falcon-1024 vk".into()))
        }
    }

    pub fn generate_keypair() -> QVResult<(QVFalcon1024SigningKey, QVFalcon1024VerifyingKey)> {
        let (pk, sk) = ffi::keypair();
        Ok((QVFalcon1024SigningKey(sk), QVFalcon1024VerifyingKey(pk)))
    }

    pub fn sign(sk: &QVFalcon1024SigningKey, msg: &[u8]) -> QVResult<Vec<u8>> {
        let sig = ffi::detached_sign(msg, &sk.0);
        Ok(sig.as_bytes().to_vec())
    }

    pub fn verify(vk: &QVFalcon1024VerifyingKey, msg: &[u8], sig: &[u8]) -> QVResult<()> {
        let parsed = ffi::DetachedSignature::from_bytes(sig)
            .map_err(|_| QVError::SignatureInvalid)?;
        match ffi::verify_detached_signature(&parsed, msg, &vk.0) {
            Ok(()) => Ok(()),
            Err(VerificationError::InvalidSignature) => Err(QVError::SignatureInvalid),
            Err(_) => Err(QVError::SignatureInvalid),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn falcon512_roundtrip() {
        let (sk, vk) = falcon512::generate_keypair().expect("keygen");
        let msg = b"QuantumVault v4.1 Falcon-512 roundtrip";
        let sig = falcon512::sign(&sk, msg).expect("sign");
        assert!(sig.len() <= falcon512::MAX_SIG_BYTES, "sig {} > max", sig.len());
        assert!(sig.len() > 500, "sig suspiciously small: {}", sig.len());
        falcon512::verify(&vk, msg, &sig).expect("verify");

        // Tamper -> rejected.
        let mut bad = sig.clone();
        bad[10] ^= 0xFF;
        assert!(falcon512::verify(&vk, msg, &bad).is_err());

        // Key serialization roundtrip.
        let vk_bytes = vk.to_bytes();
        assert_eq!(vk_bytes.len(), falcon512::VK_BYTES);
        let vk2 = falcon512::QVFalcon512VerifyingKey::from_bytes(&vk_bytes).expect("vk parse");
        falcon512::verify(&vk2, msg, &sig).expect("verify after reparse");
    }

    #[test]
    fn falcon1024_roundtrip() {
        let (sk, vk) = falcon1024::generate_keypair().expect("keygen");
        let msg = b"QuantumVault v4.1 Falcon-1024 roundtrip";
        let sig = falcon1024::sign(&sk, msg).expect("sign");
        assert!(sig.len() <= falcon1024::MAX_SIG_BYTES, "sig {} > max", sig.len());
        assert!(sig.len() > 1000, "sig suspiciously small: {}", sig.len());
        falcon1024::verify(&vk, msg, &sig).expect("verify");

        let sk_bytes = sk.to_bytes();
        assert_eq!(sk_bytes.len(), falcon1024::SK_BYTES);
    }

    #[test]
    fn size_advantage_vs_mldsa87() {
        // Pure informational — proves why Falcon is worth the C dep.
        let (sk, _vk) = falcon512::generate_keypair().expect("keygen");
        let sig = falcon512::sign(&sk, b"size demo").expect("sign");
        // ML-DSA-87 is 4627 bytes flat. Falcon-512 should be <= 666.
        assert!(sig.len() < 4627 / 5, "expected at least 5x smaller than ML-DSA-87");
    }
}
