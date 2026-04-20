//! QuantumVault — C ABI shared library.
//!
//! Caller-allocated output buffers. Returns 0 on success, negative on error.
//! Pure functions only — no global state, no long-lived handles.

#![allow(non_snake_case)]

use core::slice;
use qv_core::crypto::engine::{
    self, QVSigningKey, QVVerifyingKey, SEED_LEN, VK_LEN, SIG_LEN,
};
#[cfg(feature = "falcon")]
use qv_core::falcon::{falcon512, falcon1024};

pub const QV_OK: i32                 =  0;
pub const QV_ERR_NULL_PTR: i32       = -1;
pub const QV_ERR_BUF_TOO_SMALL: i32  = -2;
pub const QV_ERR_BAD_LEN: i32        = -3;
pub const QV_ERR_CRYPTO: i32         = -4;

// ML-DSA-87 (default).
#[no_mangle] pub extern "C" fn qv_vk_len()  -> u32 { VK_LEN   as u32 }
#[no_mangle] pub extern "C" fn qv_sk_len()  -> u32 { SEED_LEN as u32 }
#[no_mangle] pub extern "C" fn qv_sig_len() -> u32 { SIG_LEN  as u32 }
#[no_mangle] pub extern "C" fn qv_abi_version() -> u32 { 2 }  // bumped for Falcon

// Falcon-512.
#[cfg(feature = "falcon")] #[no_mangle] pub extern "C" fn qv_falcon512_vk_len()      -> u32 { falcon512::VK_BYTES      as u32 }
#[cfg(feature = "falcon")] #[no_mangle] pub extern "C" fn qv_falcon512_sk_len()      -> u32 { falcon512::SK_BYTES      as u32 }
#[cfg(feature = "falcon")] #[no_mangle] pub extern "C" fn qv_falcon512_sig_max_len() -> u32 { falcon512::MAX_SIG_BYTES as u32 }

// Falcon-1024.
#[cfg(feature = "falcon")] #[no_mangle] pub extern "C" fn qv_falcon1024_vk_len()      -> u32 { falcon1024::VK_BYTES      as u32 }
#[cfg(feature = "falcon")] #[no_mangle] pub extern "C" fn qv_falcon1024_sk_len()      -> u32 { falcon1024::SK_BYTES      as u32 }
#[cfg(feature = "falcon")] #[no_mangle] pub extern "C" fn qv_falcon1024_sig_max_len() -> u32 { falcon1024::MAX_SIG_BYTES as u32 }

/// Generate a fresh keypair. `sk_out` must be 32 B, `vk_out` must be 2592 B.
#[no_mangle]
pub unsafe extern "C" fn qv_keygen(
    sk_out: *mut u8, sk_out_len: u32,
    vk_out: *mut u8, vk_out_len: u32,
) -> i32 {
    if sk_out.is_null() || vk_out.is_null() { return QV_ERR_NULL_PTR; }
    if sk_out_len as usize != SEED_LEN || vk_out_len as usize != VK_LEN {
        return QV_ERR_BAD_LEN;
    }
    match engine::generate_keypair() {
        Ok((sk, vk)) => {
            let sk_bytes = sk.to_bytes();
            let vk_bytes = vk.to_bytes();
            slice::from_raw_parts_mut(sk_out, SEED_LEN).copy_from_slice(&sk_bytes);
            slice::from_raw_parts_mut(vk_out, VK_LEN).copy_from_slice(&vk_bytes);
            QV_OK
        }
        Err(_) => QV_ERR_CRYPTO,
    }
}

/// Sign `msg` with 32-byte seed `sk`. Writes `SIG_LEN` bytes to `sig_out`.
#[no_mangle]
pub unsafe extern "C" fn qv_sign(
    sk:      *const u8, sk_len:  u32,
    msg:     *const u8, msg_len: u32,
    sig_out: *mut u8,   sig_cap: u32,
) -> i32 {
    if sk.is_null() || msg.is_null() || sig_out.is_null() { return QV_ERR_NULL_PTR; }
    if sk_len as usize != SEED_LEN { return QV_ERR_BAD_LEN; }
    if (sig_cap as usize) < SIG_LEN { return QV_ERR_BUF_TOO_SMALL; }

    let sk_bytes = slice::from_raw_parts(sk,  SEED_LEN);
    let msg_buf  = slice::from_raw_parts(msg, msg_len as usize);
    let signing  = match QVSigningKey::from_bytes(sk_bytes) {
        Ok(s) => s, Err(_) => return QV_ERR_CRYPTO,
    };
    match engine::sign(&signing, msg_buf) {
        Ok(sig) => {
            slice::from_raw_parts_mut(sig_out, SIG_LEN).copy_from_slice(&sig);
            QV_OK
        }
        Err(_) => QV_ERR_CRYPTO,
    }
}

/// Verify. Returns 1 if valid, 0 if invalid, <0 on error.
#[no_mangle]
pub unsafe extern "C" fn qv_verify(
    vk:  *const u8, vk_len:  u32,
    msg: *const u8, msg_len: u32,
    sig: *const u8, sig_len: u32,
) -> i32 {
    if vk.is_null() || msg.is_null() || sig.is_null() { return QV_ERR_NULL_PTR; }
    if vk_len as usize != VK_LEN || sig_len as usize != SIG_LEN { return QV_ERR_BAD_LEN; }

    let vk_bytes  = slice::from_raw_parts(vk,  VK_LEN);
    let msg_buf   = slice::from_raw_parts(msg, msg_len as usize);
    let sig_bytes = slice::from_raw_parts(sig, SIG_LEN);

    let verifying = match QVVerifyingKey::from_bytes(vk_bytes) {
        Ok(v) => v, Err(_) => return QV_ERR_CRYPTO,
    };
    match engine::verify(&verifying, msg_buf, sig_bytes) {
        Ok(())  => 1,
        Err(_)  => 0,
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Falcon-512 FFI
// ─────────────────────────────────────────────────────────────────────────
#[cfg(feature = "falcon")]
mod falcon_ffi {
use super::*;

/// Generate a Falcon-512 keypair. sk_out must be SK_BYTES, vk_out must be VK_BYTES.
#[no_mangle]
pub unsafe extern "C" fn qv_falcon512_keygen(
    sk_out: *mut u8, sk_out_len: u32,
    vk_out: *mut u8, vk_out_len: u32,
) -> i32 {
    if sk_out.is_null() || vk_out.is_null() { return QV_ERR_NULL_PTR; }
    if sk_out_len as usize != falcon512::SK_BYTES
        || vk_out_len as usize != falcon512::VK_BYTES { return QV_ERR_BAD_LEN; }
    match falcon512::generate_keypair() {
        Ok((sk, vk)) => {
            let sk_bytes = sk.to_bytes();
            let vk_bytes = vk.to_bytes();
            slice::from_raw_parts_mut(sk_out, falcon512::SK_BYTES).copy_from_slice(&sk_bytes);
            slice::from_raw_parts_mut(vk_out, falcon512::VK_BYTES).copy_from_slice(&vk_bytes);
            QV_OK
        }
        Err(_) => QV_ERR_CRYPTO,
    }
}

/// Sign with Falcon-512. Signature is variable length — writes actual len to *sig_len_out.
/// sig_cap must be >= qv_falcon512_sig_max_len().
#[no_mangle]
pub unsafe extern "C" fn qv_falcon512_sign(
    sk:          *const u8, sk_len:  u32,
    msg:         *const u8, msg_len: u32,
    sig_out:     *mut u8,   sig_cap: u32,
    sig_len_out: *mut u32,
) -> i32 {
    if sk.is_null() || msg.is_null() || sig_out.is_null() || sig_len_out.is_null() {
        return QV_ERR_NULL_PTR;
    }
    if sk_len as usize != falcon512::SK_BYTES { return QV_ERR_BAD_LEN; }
    if (sig_cap as usize) < falcon512::MAX_SIG_BYTES { return QV_ERR_BUF_TOO_SMALL; }

    let sk_bytes = slice::from_raw_parts(sk, falcon512::SK_BYTES);
    let msg_buf  = slice::from_raw_parts(msg, msg_len as usize);
    let signing  = match falcon512::QVFalcon512SigningKey::from_bytes(sk_bytes) {
        Ok(s) => s, Err(_) => return QV_ERR_CRYPTO,
    };
    match falcon512::sign(&signing, msg_buf) {
        Ok(sig) => {
            slice::from_raw_parts_mut(sig_out, sig.len()).copy_from_slice(&sig);
            *sig_len_out = sig.len() as u32;
            QV_OK
        }
        Err(_) => QV_ERR_CRYPTO,
    }
}

/// Verify Falcon-512 detached signature. Returns 1 valid, 0 invalid, <0 error.
#[no_mangle]
pub unsafe extern "C" fn qv_falcon512_verify(
    vk:  *const u8, vk_len:  u32,
    msg: *const u8, msg_len: u32,
    sig: *const u8, sig_len: u32,
) -> i32 {
    if vk.is_null() || msg.is_null() || sig.is_null() { return QV_ERR_NULL_PTR; }
    if vk_len as usize != falcon512::VK_BYTES { return QV_ERR_BAD_LEN; }
    if (sig_len as usize) > falcon512::MAX_SIG_BYTES { return QV_ERR_BAD_LEN; }

    let vk_bytes  = slice::from_raw_parts(vk, falcon512::VK_BYTES);
    let msg_buf   = slice::from_raw_parts(msg, msg_len as usize);
    let sig_bytes = slice::from_raw_parts(sig, sig_len as usize);

    let verifying = match falcon512::QVFalcon512VerifyingKey::from_bytes(vk_bytes) {
        Ok(v) => v, Err(_) => return QV_ERR_CRYPTO,
    };
    match falcon512::verify(&verifying, msg_buf, sig_bytes) {
        Ok(()) => 1, Err(_) => 0,
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Falcon-1024 FFI
// ─────────────────────────────────────────────────────────────────────────

#[no_mangle]
pub unsafe extern "C" fn qv_falcon1024_keygen(
    sk_out: *mut u8, sk_out_len: u32,
    vk_out: *mut u8, vk_out_len: u32,
) -> i32 {
    if sk_out.is_null() || vk_out.is_null() { return QV_ERR_NULL_PTR; }
    if sk_out_len as usize != falcon1024::SK_BYTES
        || vk_out_len as usize != falcon1024::VK_BYTES { return QV_ERR_BAD_LEN; }
    match falcon1024::generate_keypair() {
        Ok((sk, vk)) => {
            let sk_bytes = sk.to_bytes();
            let vk_bytes = vk.to_bytes();
            slice::from_raw_parts_mut(sk_out, falcon1024::SK_BYTES).copy_from_slice(&sk_bytes);
            slice::from_raw_parts_mut(vk_out, falcon1024::VK_BYTES).copy_from_slice(&vk_bytes);
            QV_OK
        }
        Err(_) => QV_ERR_CRYPTO,
    }
}

#[no_mangle]
pub unsafe extern "C" fn qv_falcon1024_sign(
    sk:          *const u8, sk_len:  u32,
    msg:         *const u8, msg_len: u32,
    sig_out:     *mut u8,   sig_cap: u32,
    sig_len_out: *mut u32,
) -> i32 {
    if sk.is_null() || msg.is_null() || sig_out.is_null() || sig_len_out.is_null() {
        return QV_ERR_NULL_PTR;
    }
    if sk_len as usize != falcon1024::SK_BYTES { return QV_ERR_BAD_LEN; }
    if (sig_cap as usize) < falcon1024::MAX_SIG_BYTES { return QV_ERR_BUF_TOO_SMALL; }

    let sk_bytes = slice::from_raw_parts(sk, falcon1024::SK_BYTES);
    let msg_buf  = slice::from_raw_parts(msg, msg_len as usize);
    let signing  = match falcon1024::QVFalcon1024SigningKey::from_bytes(sk_bytes) {
        Ok(s) => s, Err(_) => return QV_ERR_CRYPTO,
    };
    match falcon1024::sign(&signing, msg_buf) {
        Ok(sig) => {
            slice::from_raw_parts_mut(sig_out, sig.len()).copy_from_slice(&sig);
            *sig_len_out = sig.len() as u32;
            QV_OK
        }
        Err(_) => QV_ERR_CRYPTO,
    }
}

#[no_mangle]
pub unsafe extern "C" fn qv_falcon1024_verify(
    vk:  *const u8, vk_len:  u32,
    msg: *const u8, msg_len: u32,
    sig: *const u8, sig_len: u32,
) -> i32 {
    if vk.is_null() || msg.is_null() || sig.is_null() { return QV_ERR_NULL_PTR; }
    if vk_len as usize != falcon1024::VK_BYTES { return QV_ERR_BAD_LEN; }
    if (sig_len as usize) > falcon1024::MAX_SIG_BYTES { return QV_ERR_BAD_LEN; }

    let vk_bytes  = slice::from_raw_parts(vk, falcon1024::VK_BYTES);
    let msg_buf   = slice::from_raw_parts(msg, msg_len as usize);
    let sig_bytes = slice::from_raw_parts(sig, sig_len as usize);

    let verifying = match falcon1024::QVFalcon1024VerifyingKey::from_bytes(vk_bytes) {
        Ok(v) => v, Err(_) => return QV_ERR_CRYPTO,
    };
    match falcon1024::verify(&verifying, msg_buf, sig_bytes) {
        Ok(()) => 1, Err(_) => 0,
    }
}

} // mod falcon_ffi
