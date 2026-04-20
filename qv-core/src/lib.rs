pub mod claims;
pub mod crypto;
pub mod error;
#[cfg(feature = "falcon")]
pub mod falcon;
pub mod issuance;
pub mod mutation;
pub mod token;
pub mod verify;

pub use claims::Claims;
pub use crypto::{QVSigningKey, QVVerifyingKey, SuiteId, generate_keypair};
pub use error::{QVError, QVResult};
pub use issuance::{IssueParams, issue_token};
pub use mutation::MutationChain;
pub use token::{QVRawToken, QVTokenHeader, TokenType, VERSION, MAGIC};
pub use verify::{verify_token, VerifyOutput};

#[cfg(test)]
mod tests {
    use super::*;

    fn test_encrypt_key() -> [u8; 32] {
        let mut k = [0u8; 32];
        for (i, b) in k.iter_mut().enumerate() { *b = i as u8; }
        k
    }

    #[test]
    fn roundtrip_issue_verify() {
        let (sk, vk) = generate_keypair().expect("keygen");
        let ek = test_encrypt_key();
        let mut chain = MutationChain::new([0xAB; 32]);

        let mut claims = Claims::new();
        claims.insert("sub", "user-123");
        claims.insert("role", "admin");

        let params = IssueParams {
            suite: SuiteId::Dilithium5,
            token_type: TokenType::Access,
            ttl_secs: 3600,
            device_fp: None,
            claims: &claims,
            signing_key: &sk,
            encrypt_key: &ek,
            chain: &mut chain,
        };

        let raw = issue_token(params).expect("issue");
        let bytes = raw.to_bytes();
        let parsed = QVRawToken::from_bytes(&bytes).expect("parse");

        let verify_chain = MutationChain::from_state([0xAB; 32], 0);
        let out = verify_token(&parsed, &vk, &ek, &verify_chain).expect("verify");

        assert_eq!(out.claims.get("sub"), Some("user-123"));
        assert_eq!(out.claims.get("role"), Some("admin"));
    }

    #[test]
    fn expired_token_rejected() {
        let (sk, vk) = generate_keypair().expect("keygen");
        let ek = test_encrypt_key();
        let mut chain = MutationChain::new([0x11; 32]);

        let mut claims = Claims::new();
        claims.insert("sub", "test");

        let params = IssueParams {
            suite: SuiteId::Dilithium5,
            token_type: TokenType::Access,
            ttl_secs: 0, // already expired
            device_fp: None,
            claims: &claims,
            signing_key: &sk,
            encrypt_key: &ek,
            chain: &mut chain,
        };

        let raw = issue_token(params).expect("issue");
        let bytes = raw.to_bytes();
        let parsed = QVRawToken::from_bytes(&bytes).expect("parse");
        let verify_chain = MutationChain::from_state([0x11; 32], 0);

        // Allow up to 1s clock skew before calling expired.
        std::thread::sleep(std::time::Duration::from_millis(1100));
        let result = verify_token(&parsed, &vk, &ek, &verify_chain);
        assert!(matches!(result, Err(QVError::Expired { .. })));
    }

    #[test]
    fn tampered_signature_rejected() {
        let (sk, vk) = generate_keypair().expect("keygen");
        let ek = test_encrypt_key();
        let mut chain = MutationChain::new([0x22; 32]);

        let mut claims = Claims::new();
        claims.insert("sub", "attacker");

        let params = IssueParams {
            suite: SuiteId::Dilithium5,
            token_type: TokenType::Access,
            ttl_secs: 3600,
            device_fp: None,
            claims: &claims,
            signing_key: &sk,
            encrypt_key: &ek,
            chain: &mut chain,
        };

        let mut raw = issue_token(params).expect("issue");
        // Flip a byte in the signature.
        raw.signature[100] ^= 0xFF;

        let verify_chain = MutationChain::from_state([0x22; 32], 0);
        let result = verify_token(&raw, &vk, &ek, &verify_chain);
        assert!(matches!(result, Err(QVError::SignatureInvalid)));
    }

    #[test]
    fn replay_rejected() {
        let (sk, vk) = generate_keypair().expect("keygen");
        let ek = test_encrypt_key();
        let mut chain = MutationChain::new([0x33; 32]);

        let mut claims = Claims::new();
        claims.insert("sub", "user");

        let params = IssueParams {
            suite: SuiteId::Dilithium5,
            token_type: TokenType::Access,
            ttl_secs: 3600,
            device_fp: None,
            claims: &claims,
            signing_key: &sk,
            encrypt_key: &ek,
            chain: &mut chain,
        };

        let raw = issue_token(params).expect("issue");

        // Verify chain already at counter 1 — token counter 1 should fail.
        let advanced_chain = MutationChain::from_state([0x33; 32], 1);
        let result = verify_token(&raw, &vk, &ek, &advanced_chain);
        assert!(matches!(result, Err(QVError::ReplayDetected { .. })));
    }

    #[test]
    fn claims_encode_decode_roundtrip() {
        let mut c = Claims::new();
        c.insert("iss", "qv.example.com");
        c.insert("sub", "user-456");
        c.insert("scope", "read:all");

        let encoded = c.encode().expect("encode");
        let decoded = Claims::decode(&encoded).expect("decode");

        assert_eq!(decoded.get("iss"), Some("qv.example.com"));
        assert_eq!(decoded.get("sub"), Some("user-456"));
        assert_eq!(decoded.get("scope"), Some("read:all"));
    }
}
