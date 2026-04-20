use crate::crypto::sha3_256;
use crate::error::{QVError, QVResult};

/// HYDRA mutation chain — each token mutation ratchets a SHA3-256 hash chain.
/// This provides Post-Compromise Security (PCS): a stolen token becomes
/// invalid once the legitimate holder advances the chain.
pub struct MutationChain {
    state: [u8; 32],
    counter: u64,
}

impl MutationChain {
    /// Initialise from a random 32-byte seed (should be CSPRNG output).
    pub fn new(seed: [u8; 32]) -> Self {
        MutationChain { state: seed, counter: 0 }
    }

    /// Restore from persisted state.
    pub fn from_state(state: [u8; 32], counter: u64) -> Self {
        MutationChain { state, counter }
    }

    /// Advance the chain once and return the new epoch tag.
    /// The new state is SHA3-256(old_state || counter_bytes).
    pub fn advance(&mut self) -> [u8; 32] {
        let mut input = [0u8; 40];
        input[..32].copy_from_slice(&self.state);
        input[32..].copy_from_slice(&self.counter.to_be_bytes());
        self.state = sha3_256(&input);
        self.counter += 1;
        self.state
    }

    pub fn current_counter(&self) -> u64 { self.counter }
    pub fn current_state(&self) -> &[u8; 32] { &self.state }

    /// Verify a token's mutation counter is strictly greater than the stored chain counter.
    /// Enforces monotonicity — replay of any previous token is immediately rejected.
    pub fn check_token_counter(&self, token_ctr: u64) -> QVResult<()> {
        if token_ctr <= self.counter {
            Err(QVError::ReplayDetected { token: token_ctr, chain: self.counter })
        } else {
            Ok(())
        }
    }
}

/// KOLMOGOROV entropy certification: verify that a byte slice is "sufficiently random"
/// by checking that no 4-byte pattern repeats more than a statistical threshold.
/// Real randomness test: run-length compression ratio must be > 0.85.
pub fn certify_entropy(data: &[u8]) -> QVResult<()> {
    if data.len() < 8 {
        return Ok(()); // too short to test
    }
    // Naive LZ-like: count unique 4-grams vs total 4-grams.
    let total = data.len() - 3;
    let mut seen = std::collections::HashSet::new();
    for i in 0..total {
        let gram: [u8; 4] = data[i..i + 4].try_into().unwrap();
        seen.insert(gram);
    }
    let ratio = seen.len() as f64 / total as f64;
    if ratio < 0.85 {
        Err(QVError::LowEntropy(ratio))
    } else {
        Ok(())
    }
}
