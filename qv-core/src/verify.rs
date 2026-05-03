use crate::claims::Claims;
use crate::crypto::{QVVerifyingKey, verify};
use crate::error::{QVError, QVResult};
use crate::issuance::decrypt_payload;
use crate::mutation::{MutationChain, certify_entropy};
use crate::token::QVRawToken;

/// Output of a successful 7-layer verification.
pub struct VerifyOutput {
    pub claims:      Claims,
    pub issued_at:   u64,
    pub ttl:         u32,
    pub mutation_ctr: u64,
}

/// 7-layer Sigvault verification pipeline.
///
/// Layer 1 — MAGIC / VERSION / SUITE structural check (done in QVRawToken::from_bytes)
/// Layer 2 — KOLMOGOROV entropy certification on nonce
/// Layer 3 — Temporal validity (not expired, not future-dated)
/// Layer 4 — ML-DSA-87 signature verification
/// Layer 5 — Payload decryption (XChaCha20-Poly1305)
/// Layer 6 — Mutation counter anti-replay
/// Layer 7 — Claims well-formedness
pub fn verify_token(
    raw:          &QVRawToken,
    vk:           &QVVerifyingKey,
    encrypt_key:  &[u8; 32],
    chain:        &MutationChain,
) -> QVResult<VerifyOutput> {

    // Layer 2 — entropy.
    certify_entropy(&raw.header.nonce)?;

    // Layer 3 — temporal check.
    let now_us = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| QVError::SerializationError(e.to_string()))?
        .as_micros() as u64;

    if raw.header.issued_at > now_us + 5_000_000 {
        return Err(QVError::NotYetValid);
    }
    let expiry_us = raw.header.issued_at + (raw.header.ttl as u64) * 1_000_000;
    if now_us > expiry_us {
        return Err(QVError::Expired { issued_at: raw.header.issued_at, ttl: raw.header.ttl });
    }

    // Layer 4 — signature.
    let msg = raw.signed_bytes();
    verify(vk, &msg, &raw.signature)?;

    // Layer 5 — decrypt payload.
    let plaintext = decrypt_payload(&raw.encrypted_payload, encrypt_key, &raw.header.nonce)?;

    // Layer 6 — mutation counter.
    chain.check_token_counter(raw.header.mutation_ctr)?;

    // Layer 7 — decode claims.
    let claims = Claims::decode(&plaintext)?;

    Ok(VerifyOutput {
        claims,
        issued_at: raw.header.issued_at,
        ttl: raw.header.ttl,
        mutation_ctr: raw.header.mutation_ctr,
    })
}

// ─── Falcon verify paths (suite-dispatched in v4.2) ─────────────────────────

/// Run the shared non-signature layers (entropy / temporal / decrypt / chain / claims).
/// Used by the Falcon verify helpers below so layers 2/3/5/6/7 are not copy-pasted.
#[cfg_attr(not(feature = "falcon"), allow(dead_code))]
fn verify_non_sig_layers(
    raw: &QVRawToken,
    encrypt_key: &[u8; 32],
    chain: &MutationChain,
) -> QVResult<VerifyOutput> {
    certify_entropy(&raw.header.nonce)?;

    let now_us = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| QVError::SerializationError(e.to_string()))?
        .as_micros() as u64;
    if raw.header.issued_at > now_us + 5_000_000 {
        return Err(QVError::NotYetValid);
    }
    let expiry_us = raw.header.issued_at + (raw.header.ttl as u64) * 1_000_000;
    if now_us > expiry_us {
        return Err(QVError::Expired { issued_at: raw.header.issued_at, ttl: raw.header.ttl });
    }

    let plaintext = decrypt_payload(&raw.encrypted_payload, encrypt_key, &raw.header.nonce)?;
    chain.check_token_counter(raw.header.mutation_ctr)?;
    let claims = Claims::decode(&plaintext)?;

    Ok(VerifyOutput {
        claims,
        issued_at: raw.header.issued_at,
        ttl: raw.header.ttl,
        mutation_ctr: raw.header.mutation_ctr,
    })
}

#[cfg(feature = "falcon")]
pub fn verify_token_falcon512(
    raw: &QVRawToken,
    vk: &crate::falcon::falcon512::QVFalcon512VerifyingKey,
    encrypt_key: &[u8; 32],
    chain: &MutationChain,
) -> QVResult<VerifyOutput> {
    if raw.header.suite != crate::crypto::SuiteId::Falcon512 {
        return Err(QVError::UnknownSuite(raw.header.suite.as_byte()));
    }
    let msg = raw.signed_bytes();
    crate::falcon::falcon512::verify(vk, &msg, &raw.signature)?;
    verify_non_sig_layers(raw, encrypt_key, chain)
}

#[cfg(feature = "falcon")]
pub fn verify_token_falcon1024(
    raw: &QVRawToken,
    vk: &crate::falcon::falcon1024::QVFalcon1024VerifyingKey,
    encrypt_key: &[u8; 32],
    chain: &MutationChain,
) -> QVResult<VerifyOutput> {
    if raw.header.suite != crate::crypto::SuiteId::Falcon1024 {
        return Err(QVError::UnknownSuite(raw.header.suite.as_byte()));
    }
    let msg = raw.signed_bytes();
    crate::falcon::falcon1024::verify(vk, &msg, &raw.signature)?;
    verify_non_sig_layers(raw, encrypt_key, chain)
}
