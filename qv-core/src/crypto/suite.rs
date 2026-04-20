use crate::error::{QVError, QVResult};

/// Token suite — defines which PQC algorithms are active.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum SuiteId {
    /// ML-DSA-87 (Dilithium-5) only — NIST FIPS 204
    Dilithium5 = 0x05,
    /// ML-DSA-87 + ML-KEM-1024 (Kyber-1024) dual-lattice — NIST FIPS 203+204
    Dual = 0x09,
    /// Triple: ML-DSA-87 + ML-KEM-1024 + SPHINCS+-256 (hash-based) — maximum security
    Triple = 0xFF,
}

impl SuiteId {
    pub fn from_byte(b: u8) -> QVResult<Self> {
        match b {
            0x05 => Ok(SuiteId::Dilithium5),
            0x09 => Ok(SuiteId::Dual),
            0xFF => Ok(SuiteId::Triple),
            other => Err(QVError::UnknownSuite(other)),
        }
    }

    pub fn as_byte(self) -> u8 {
        self as u8
    }

    /// Size in bytes of the primary signature for this suite.
    pub fn sig_len(self) -> usize {
        match self {
            SuiteId::Dilithium5 => 4595,  // ML-DSA-87
            SuiteId::Dual => 4595,
            SuiteId::Triple => 4595 + 49_856, // ML-DSA-87 + SPHINCS+-256
        }
    }

    /// Human-readable name.
    pub fn name(self) -> &'static str {
        match self {
            SuiteId::Dilithium5 => "ML-DSA-87 (Suite 0x05)",
            SuiteId::Dual => "ML-DSA-87 + ML-KEM-1024 (Suite 0x09)",
            SuiteId::Triple => "ML-DSA-87 + ML-KEM-1024 + SPHINCS+-256 (Suite 0xFF)",
        }
    }
}
