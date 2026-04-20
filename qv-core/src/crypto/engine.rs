use ml_dsa::{MlDsa87, EncodedVerifyingKey, KeyGen};
use ml_dsa::signature::{Signer, Verifier};
use rand::rngs::OsRng;
use sha3::{Sha3_256, Digest};
use zeroize::Zeroizing;
use crate::error::{QVError, QVResult};

/// ML-DSA-87 signature size (FIPS 204, security level 5).
pub const SIG_LEN: usize = 4627;
/// ML-DSA-87 verifying key size.
pub const VK_LEN: usize = 2592;
/// Signing key seed size (32 bytes — preferred serialization).
pub const SEED_LEN: usize = 32;

// ─── Key wrappers ─────────────────────────────────────────────────────────────

/// Signing (private) key — wraps the 32-byte seed + expanded state.
pub struct QVSigningKey {
    inner: ml_dsa::SigningKey<MlDsa87>,
}

/// Verifying (public) key for ML-DSA-87.
pub struct QVVerifyingKey {
    inner: ml_dsa::VerifyingKey<MlDsa87>,
}

impl QVSigningKey {
    /// Restore from a 32-byte seed.
    pub fn from_bytes(seed: &[u8]) -> QVResult<Self> {
        if seed.len() != SEED_LEN {
            return Err(QVError::KeyGenFailed);
        }
        let arr: ml_dsa::B32 = seed.try_into().map_err(|_| QVError::KeyGenFailed)?;
        Ok(QVSigningKey { inner: MlDsa87::from_seed(&arr) })
    }

    /// Serialize as 32-byte seed (zeroized on drop).
    pub fn to_bytes(&self) -> Zeroizing<Vec<u8>> {
        Zeroizing::new(self.inner.to_seed().to_vec())
    }
}

impl QVVerifyingKey {
    /// Deserialize from raw bytes (2592 bytes for ML-DSA-87).
    pub fn from_bytes(bytes: &[u8]) -> QVResult<Self> {
        let arr = EncodedVerifyingKey::<MlDsa87>::try_from(bytes)
            .map_err(|_| QVError::KeyGenFailed)?;
        Ok(QVVerifyingKey { inner: ml_dsa::VerifyingKey::decode(&arr) })
    }

    /// Serialize to raw bytes.
    pub fn to_bytes(&self) -> Vec<u8> {
        self.inner.encode().to_vec()
    }
}

// ─── Operations ───────────────────────────────────────────────────────────────

/// Generate a fresh ML-DSA-87 keypair using OS CSPRNG.
///
/// We generate a random 32-byte seed with `rand 0.8` (OS-backed) and pass it
/// to `MlDsa87::from_seed` — this sidesteps the `rand_core` v0.6 vs v0.9
/// version mismatch between our `rand` dep and ml-dsa's internal rand_core.
pub fn generate_keypair() -> QVResult<(QVSigningKey, QVVerifyingKey)> {
    use rand::RngCore;
    let mut seed_bytes = [0u8; 32];
    OsRng.fill_bytes(&mut seed_bytes);
    let seed: ml_dsa::B32 = seed_bytes.into();
    let sk_inner = MlDsa87::from_seed(&seed);
    let vk_inner = ml_dsa::signature::Keypair::verifying_key(&sk_inner);
    Ok((QVSigningKey { inner: sk_inner }, QVVerifyingKey { inner: vk_inner }))
}

/// Sign a message with ML-DSA-87 (deterministic). Returns 4627-byte signature.
pub fn sign(sk: &QVSigningKey, message: &[u8]) -> QVResult<Vec<u8>> {
    let sig: ml_dsa::Signature<MlDsa87> = sk.inner.try_sign(message)
        .map_err(|_| QVError::SignatureInvalid)?;
    Ok(sig.encode().to_vec())
}

/// Verify an ML-DSA-87 signature over `message`.
pub fn verify(vk: &QVVerifyingKey, message: &[u8], signature_bytes: &[u8]) -> QVResult<()> {
    let sig = ml_dsa::Signature::<MlDsa87>::try_from(signature_bytes)
        .map_err(|_| QVError::SignatureInvalid)?;
    vk.inner.verify(message, &sig).map_err(|_| QVError::SignatureInvalid)
}

/// SHA3-256 digest.
pub fn sha3_256(data: &[u8]) -> [u8; 32] {
    let mut h = Sha3_256::new();
    h.update(data);
    h.finalize().into()
}
