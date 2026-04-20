use crate::error::{QVError, QVResult};

/// Token suite — defines which PQC algorithms are active.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum SuiteId {
    /// ML-DSA-87 (Dilithium-5) only — NIST FIPS 204
    Dilithium5 = 0x05,
    /// ML-DSA-87 + ML-KEM-1024 (Kyber-1024) dual-lattice — NIST FIPS 203+204
    Dual = 0x09,
    /// Falcon-512 — PQClean, PQ-128, ≤666B variable-length signature
    Falcon512 = 0x10,
    /// Falcon-1024 — PQClean, PQ-256, ≤1280B variable-length signature
    Falcon1024 = 0x11,
    /// Triple: ML-DSA-87 + ML-KEM-1024 + SPHINCS+-256 (hash-based) — maximum security
    Triple = 0xFF,
}

impl SuiteId {
    pub fn from_byte(b: u8) -> QVResult<Self> {
        match b {
            0x05 => Ok(SuiteId::Dilithium5),
            0x09 => Ok(SuiteId::Dual),
            0x10 => Ok(SuiteId::Falcon512),
            0x11 => Ok(SuiteId::Falcon1024),
            0xFF => Ok(SuiteId::Triple),
            other => Err(QVError::UnknownSuite(other)),
        }
    }

    pub fn as_byte(self) -> u8 {
        self as u8
    }

    /// Maximum signature length for this suite (Falcon is variable; returns upper bound).
    pub fn sig_len(self) -> usize {
        match self {
            SuiteId::Dilithium5 => 4627,
            SuiteId::Dual => 4627,
            SuiteId::Falcon512 => 666,
            SuiteId::Falcon1024 => 1280,
            SuiteId::Triple => 4627 + 49_856,
        }
    }

    /// True if signatures are variable-length (Falcon).
    pub fn sig_is_variable_length(self) -> bool {
        matches!(self, SuiteId::Falcon512 | SuiteId::Falcon1024)
    }

    /// Human-readable name.
    pub fn name(self) -> &'static str {
        match self {
            SuiteId::Dilithium5 => "ML-DSA-87 (Suite 0x05)",
            SuiteId::Dual => "ML-DSA-87 + ML-KEM-1024 (Suite 0x09)",
            SuiteId::Falcon512 => "Falcon-512 (Suite 0x10)",
            SuiteId::Falcon1024 => "Falcon-1024 (Suite 0x11)",
            SuiteId::Triple => "ML-DSA-87 + ML-KEM-1024 + SPHINCS+-256 (Suite 0xFF)",
        }
    }
}
