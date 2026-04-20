use thiserror::Error;

#[derive(Debug, Error)]
pub enum QVError {
    #[error("Invalid magic bytes: expected QVLT")]
    InvalidMagic,

    #[error("Unsupported token version: {0:#06x}")]
    UnsupportedVersion(u16),

    #[error("Unknown suite ID: {0:#04x}")]
    UnknownSuite(u8),

    #[error("Token has expired (issued {issued_at}, ttl {ttl}s)")]
    Expired { issued_at: u64, ttl: u32 },

    #[error("Token not yet valid")]
    NotYetValid,

    #[error("Signature verification failed")]
    SignatureInvalid,

    #[error("Payload decryption failed")]
    DecryptionFailed,

    #[error("Buffer too short: need {need}, have {have}")]
    BufferTooShort { need: usize, have: usize },

    #[error("Mutation counter replay: token counter {token} <= chain counter {chain}")]
    ReplayDetected { token: u64, chain: u64 },

    #[error("Entropy certification failed: compression ratio {0:.3} indicates non-random data")]
    LowEntropy(f64),

    #[error("Nonce reuse detected")]
    NonceReuse,

    #[error("Key generation failed")]
    KeyGenFailed,

    #[error("Serialization error: {0}")]
    SerializationError(String),

    #[error("Claims field missing: {0}")]
    MissingClaim(String),
}

pub type QVResult<T> = Result<T, QVError>;
