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

/// Issue a new QuantumVault token.
pub fn issue_token(p: IssueParams<'_>) -> QVResult<QVRawToken> {
    // 1. Timestamp (microseconds). Use std::time — no external dep needed.
    let issued_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| QVError::SerializationError(e.to_string()))?
        .as_micros() as u64;

    // 2. CSPRNG nonce (32 bytes).
    let mut nonce = [0u8; 32];
    OsRng.fill_bytes(&mut nonce);

    // 3. KOLMOGOROV entropy check on the nonce.
    certify_entropy(&nonce)?;

    // 4. Device fingerprint — default to SHA3-256 of nonce if not provided.
    let device_fp = p.device_fp.unwrap_or_else(|| sha3_256(&nonce));

    // 5. Advance mutation chain.
    let _ = p.chain.advance();
    let mutation_ctr = p.chain.current_counter();

    // 6. Encode and encrypt payload (XChaCha20-Poly1305).
    let plaintext = p.claims.encode()?;
    let encrypted_payload = encrypt_payload(&plaintext, p.encrypt_key, &nonce)?;

    // 7. Assemble header.
    let header = QVTokenHeader {
        suite: p.suite,
        token_type: p.token_type,
        issued_at,
        ttl: p.ttl_secs,
        nonce,
        device_fp,
        mutation_ctr,
    };

    // 8. Build token shell to obtain signed bytes.
    let shell = QVRawToken { header, encrypted_payload, signature: Vec::new() };
    let msg = shell.signed_bytes();

    // 9. ML-DSA-87 signature over all bytes except the signature field itself.
    let signature = sign(p.signing_key, &msg)?;

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
