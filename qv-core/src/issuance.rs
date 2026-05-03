use chacha20poly1305::{XChaCha20Poly1305, Key, XNonce, KeyInit, AeadInPlace};
use rand::rngs::OsRng;
use rand::RngCore;

use crate::claims::Claims;
use crate::crypto::{QVSigningKey, sha3_256, sign};
use crate::error::{QVError, QVResult};
use crate::mutation::{MutationChain, certify_entropy};
use crate::crypto::SuiteId;
use crate::token::{QVRawToken, QVTokenHeader, TokenType};

/// Parameters for issuing a new token.
pub struct IssueParams<'a> {
    pub suite:        SuiteId,
    pub token_type:   TokenType,
    pub ttl_secs:     u32,
    pub device_fp:    Option<[u8; 32]>,
    pub claims:       &'a Claims,
    pub signing_key:  &'a QVSigningKey,
    pub encrypt_key:  &'a [u8; 32], // XChaCha20-Poly1305 symmetric key
    pub chain:        &'a mut MutationChain,
}

/// Issue a new Sigvault token (ML-DSA-87 default path).
pub fn issue_token(p: IssueParams<'_>) -> QVResult<QVRawToken> {
    let (shell, msg) = prepare_unsigned(
        p.suite, p.token_type, p.ttl_secs, p.device_fp,
        p.claims, p.encrypt_key, p.chain,
    )?;
    let signature = sign(p.signing_key, &msg)?;
    Ok(QVRawToken { header: shell.header, encrypted_payload: shell.encrypted_payload, signature })
}

/// Shared pre-sign pipeline: timestamp, nonce, entropy, chain advance,
/// encrypt payload, build header, compute the byte-range the signature
/// must cover. Suite-specific signing plugs in on top.
pub fn prepare_unsigned(
    suite: crate::crypto::SuiteId,
    token_type: TokenType,
    ttl_secs: u32,
    device_fp_opt: Option<[u8; 32]>,
    claims: &crate::claims::Claims,
    encrypt_key: &[u8; 32],
    chain: &mut MutationChain,
) -> QVResult<(QVRawToken, Vec<u8>)> {
    let issued_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| QVError::SerializationError(e.to_string()))?
        .as_micros() as u64;

    let mut nonce = [0u8; 32];
    OsRng.fill_bytes(&mut nonce);
    certify_entropy(&nonce)?;

    let device_fp = device_fp_opt.unwrap_or_else(|| sha3_256(&nonce));

    let _ = chain.advance();
    let mutation_ctr = chain.current_counter();

    let plaintext = claims.encode()?;
    let encrypted_payload = encrypt_payload(&plaintext, encrypt_key, &nonce)?;

    let header = QVTokenHeader {
        suite, token_type, issued_at, ttl: ttl_secs,
        nonce, device_fp, mutation_ctr,
    };

    let shell = QVRawToken { header, encrypted_payload, signature: Vec::new() };
    let msg = shell.signed_bytes();
    Ok((shell, msg))
}

/// Issue a Falcon-512 token (suite 0x10).
#[cfg(feature = "falcon")]
pub fn issue_token_falcon512(
    token_type: TokenType,
    ttl_secs: u32,
    device_fp: Option<[u8; 32]>,
    claims: &crate::claims::Claims,
    signing_key: &crate::falcon::falcon512::QVFalcon512SigningKey,
    encrypt_key: &[u8; 32],
    chain: &mut MutationChain,
) -> QVResult<QVRawToken> {
    let (shell, msg) = prepare_unsigned(
        crate::crypto::SuiteId::Falcon512, token_type, ttl_secs,
        device_fp, claims, encrypt_key, chain,
    )?;
    let signature = crate::falcon::falcon512::sign(signing_key, &msg)?;
    Ok(QVRawToken { header: shell.header, encrypted_payload: shell.encrypted_payload, signature })
}

/// Issue a Falcon-1024 token (suite 0x11).
#[cfg(feature = "falcon")]
pub fn issue_token_falcon1024(
    token_type: TokenType,
    ttl_secs: u32,
    device_fp: Option<[u8; 32]>,
    claims: &crate::claims::Claims,
    signing_key: &crate::falcon::falcon1024::QVFalcon1024SigningKey,
    encrypt_key: &[u8; 32],
    chain: &mut MutationChain,
) -> QVResult<QVRawToken> {
    let (shell, msg) = prepare_unsigned(
        crate::crypto::SuiteId::Falcon1024, token_type, ttl_secs,
        device_fp, claims, encrypt_key, chain,
    )?;
    let signature = crate::falcon::falcon1024::sign(signing_key, &msg)?;
    Ok(QVRawToken { header: shell.header, encrypted_payload: shell.encrypted_payload, signature })
}

/// XChaCha20-Poly1305 AEAD encrypt.
/// The 24-byte XChaCha nonce is derived via SHA3-256(token_nonce)[..24].
fn encrypt_payload(plaintext: &[u8], key: &[u8; 32], token_nonce: &[u8; 32]) -> QVResult<Vec<u8>> {
    let digest = sha3_256(token_nonce);
    let xchacha_nonce = XNonce::from_slice(&digest[..24]);
    let cipher = XChaCha20Poly1305::new(Key::from_slice(key));

    let mut buf = plaintext.to_vec();
    cipher
        .encrypt_in_place(xchacha_nonce, b"", &mut buf)
        .map_err(|_| QVError::DecryptionFailed)?;
    Ok(buf)
}

/// XChaCha20-Poly1305 AEAD decrypt (exposed for verify layer).
pub fn decrypt_payload(ciphertext: &[u8], key: &[u8; 32], token_nonce: &[u8; 32]) -> QVResult<Vec<u8>> {
    let digest = sha3_256(token_nonce);
    let xchacha_nonce = XNonce::from_slice(&digest[..24]);
    let cipher = XChaCha20Poly1305::new(Key::from_slice(key));

    let mut buf = ciphertext.to_vec();
    cipher
        .decrypt_in_place(xchacha_nonce, b"", &mut buf)
        .map_err(|_| QVError::DecryptionFailed)?;
    Ok(buf)
}
