use crate::crypto::SuiteId;
use crate::error::{QVError, QVResult};

/// Token type byte.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum TokenType {
    Access = 0x01,
    Refresh = 0x02,
    Service = 0x03,
}

impl TokenType {
    pub fn from_byte(b: u8) -> QVResult<Self> {
        match b {
            0x01 => Ok(TokenType::Access),
            0x02 => Ok(TokenType::Refresh),
            0x03 => Ok(TokenType::Service),
            _ => Err(QVError::SerializationError(format!("unknown token type {b:#04x}"))),
        }
    }
    pub fn as_byte(self) -> u8 { self as u8 }
}

/// Magic constant "QVLT" in big-endian.
pub const MAGIC: u32 = 0x51564C54;
pub const VERSION: u16 = 0x0300; // v3.0

/// Decoded (plain-text) binary header before payload encryption.
#[derive(Debug, Clone)]
pub struct QVTokenHeader {
    pub suite:       SuiteId,
    pub token_type:  TokenType,
    pub issued_at:   u64,  // microseconds since Unix epoch
    pub ttl:         u32,  // seconds
    pub nonce:       [u8; 32],
    pub device_fp:   [u8; 32],
    pub mutation_ctr: u64,
}

/// Full serialised token (header + encrypted payload + signature).
///
/// Wire format (all big-endian):
/// +0    4B   MAGIC 0x51564C54
/// +4    2B   VERSION 0x0300
/// +6    1B   SUITE_ID
/// +7    1B   TOKEN_TYPE
/// +8    8B   ISSUED_AT (µs)
/// +16   4B   TTL (s)
/// +20  32B   NONCE
/// +52  32B   DEVICE_FP
/// +84   4B   PAYLOAD_LEN
/// +88   var  ENCRYPTED_PAYLOAD (XChaCha20-Poly1305)
/// +88+PL 8B  MUTATION_CTR
/// +96+PL var SIGNATURE (ML-DSA-87 = 4595B for Suite 0x05)
#[derive(Debug, Clone)]
pub struct QVRawToken {
    pub header:            QVTokenHeader,
    pub encrypted_payload: Vec<u8>,
    pub signature:         Vec<u8>,
}

impl QVRawToken {
    /// Serialize to wire bytes.
    pub fn to_bytes(&self) -> Vec<u8> {
        let h = &self.header;
        let pl = self.encrypted_payload.len() as u32;
        let mut buf = Vec::with_capacity(96 + self.encrypted_payload.len() + self.signature.len());

        buf.extend_from_slice(&MAGIC.to_be_bytes());
        buf.extend_from_slice(&VERSION.to_be_bytes());
        buf.push(h.suite.as_byte());
        buf.push(h.token_type.as_byte());
        buf.extend_from_slice(&h.issued_at.to_be_bytes());
        buf.extend_from_slice(&h.ttl.to_be_bytes());
        buf.extend_from_slice(&h.nonce);
        buf.extend_from_slice(&h.device_fp);
        buf.extend_from_slice(&pl.to_be_bytes());
        buf.extend_from_slice(&self.encrypted_payload);
        buf.extend_from_slice(&h.mutation_ctr.to_be_bytes());
        buf.extend_from_slice(&self.signature);
        buf
    }

    /// Deserialize from wire bytes.
    pub fn from_bytes(data: &[u8]) -> QVResult<Self> {
        macro_rules! need {
            ($n:expr) => {
                if data.len() < $n {
                    return Err(QVError::BufferTooShort { need: $n, have: data.len() });
                }
            };
        }

        need!(88);

        let magic = u32::from_be_bytes(data[0..4].try_into().unwrap());
        if magic != MAGIC {
            return Err(QVError::InvalidMagic);
        }

        let version = u16::from_be_bytes(data[4..6].try_into().unwrap());
        if version != VERSION {
            return Err(QVError::UnsupportedVersion(version));
        }

        let suite      = SuiteId::from_byte(data[6])?;
        let token_type = TokenType::from_byte(data[7])?;
        let issued_at  = u64::from_be_bytes(data[8..16].try_into().unwrap());
        let ttl        = u32::from_be_bytes(data[16..20].try_into().unwrap());
        let nonce: [u8; 32]     = data[20..52].try_into().unwrap();
        let device_fp: [u8; 32] = data[52..84].try_into().unwrap();
        let pl         = u32::from_be_bytes(data[84..88].try_into().unwrap()) as usize;

        need!(88 + pl + 8);
        let encrypted_payload = data[88..88 + pl].to_vec();

        let mc_off     = 88 + pl;
        let mutation_ctr = u64::from_be_bytes(data[mc_off..mc_off + 8].try_into().unwrap());

        let sig_off    = mc_off + 8;
        need!(sig_off + 1);
        let signature  = data[sig_off..].to_vec();

        Ok(QVRawToken {
            header: QVTokenHeader { suite, token_type, issued_at, ttl, nonce, device_fp, mutation_ctr },
            encrypted_payload,
            signature,
        })
    }

    /// The bytes that are covered by the signature (everything except the sig itself).
    pub fn signed_bytes(&self) -> Vec<u8> {
        let h = &self.header;
        let pl = self.encrypted_payload.len() as u32;
        let mut buf = Vec::new();
        buf.extend_from_slice(&MAGIC.to_be_bytes());
        buf.extend_from_slice(&VERSION.to_be_bytes());
        buf.push(h.suite.as_byte());
        buf.push(h.token_type.as_byte());
        buf.extend_from_slice(&h.issued_at.to_be_bytes());
        buf.extend_from_slice(&h.ttl.to_be_bytes());
        buf.extend_from_slice(&h.nonce);
        buf.extend_from_slice(&h.device_fp);
        buf.extend_from_slice(&pl.to_be_bytes());
        buf.extend_from_slice(&self.encrypted_payload);
        buf.extend_from_slice(&h.mutation_ctr.to_be_bytes());
        buf
    }
}
