//! Sigvault — WebAssembly exports.
//! Stdlib-only (no wasm-bindgen) to preserve sovereignty.
//!
//! v4.1: unblocks `wasm32-unknown-unknown` by registering a custom
//! getrandom shim that forwards to a host-provided import.
//!
//! Host contract:
//! ```text
//! // The WASM module declares one import:
//! (import "env" "qv_host_random" (func (param i32 i32) (result i32)))
//! // Host impl fills `len` bytes of cryptographic entropy at `ptr`.
//! // Return 0 on success, any other value is treated as an error.
//! ```

#![allow(non_snake_case)]

use core::alloc::Layout;
use qv_core::crypto::engine::{
    self, QVSigningKey, QVVerifyingKey, SEED_LEN, VK_LEN, SIG_LEN,
};

// ─────────────────────────────────────────────────────────────────────────
// Custom getrandom shim — the thing that unblocks wasm32-unknown-unknown.
// ─────────────────────────────────────────────────────────────────────────
#[cfg(target_arch = "wasm32")]
extern "C" {
    /// Host-provided entropy. Must fill `len` bytes at `ptr`, return 0 on ok.
    fn qv_host_random(ptr: *mut u8, len: u32) -> i32;
}

#[cfg(target_arch = "wasm32")]
fn host_fill(buf: &mut [u8]) -> Result<(), getrandom::Error> {
    let rc = unsafe { qv_host_random(buf.as_mut_ptr(), buf.len() as u32) };
    if rc == 0 { Ok(()) } else { Err(getrandom::Error::UNEXPECTED) }
}

#[cfg(target_arch = "wasm32")]
getrandom::register_custom_getrandom!(host_fill);

// ─────────────────────────────────────────────────────────────────────────
// Custom backend for getrandom 0.3 / 0.4 (pulled transitively by newer
// ml-dsa / ml-kem RCs). Both versions import the same unmangled symbol
// `__getrandom_v03_custom`; their Error type is `#[repr(transparent)]`
// NonZeroU32, so a single implementation satisfies both. The `custom`
// backend is selected via RUSTFLAGS in .cargo/config.toml.
// ─────────────────────────────────────────────────────────────────────────
#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub unsafe extern "Rust" fn __getrandom_v03_custom(
    dest: *mut u8, len: usize,
) -> Result<(), core::num::NonZeroU32> {
    let rc = unsafe { qv_host_random(dest, len as u32) };
    if rc == 0 {
        Ok(())
    } else {
        // getrandom 0.3/0.4 Error is repr(transparent) over NonZeroU32; any
        // non-zero error code is fine.
        Err(core::num::NonZeroU32::new(rc.unsigned_abs()).unwrap_or(
            core::num::NonZeroU32::new(1).unwrap()
        ))
    }
}

#[no_mangle]
pub extern "C" fn qv_wasm_alloc(len: usize) -> *mut u8 {
    if len == 0 { return core::ptr::null_mut(); }
    unsafe {
        let layout = Layout::from_size_align_unchecked(len, 1);
        std::alloc::alloc(layout)
    }
}

#[no_mangle]
pub extern "C" fn qv_wasm_free(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 { return; }
    unsafe {
        let layout = Layout::from_size_align_unchecked(len, 1);
        std::alloc::dealloc(ptr, layout);
    }
}

#[no_mangle] pub extern "C" fn qv_wasm_vk_len()  -> u32 { VK_LEN   as u32 }
#[no_mangle] pub extern "C" fn qv_wasm_sk_len()  -> u32 { SEED_LEN as u32 }
#[no_mangle] pub extern "C" fn qv_wasm_sig_len() -> u32 { SIG_LEN  as u32 }

#[no_mangle]
pub unsafe extern "C" fn qv_wasm_keygen(sk_out: *mut u8, vk_out: *mut u8) -> i32 {
    match engine::generate_keypair() {
        Ok((sk, vk)) => {
            let sk_bytes = sk.to_bytes();
            let vk_bytes = vk.to_bytes();
            core::slice::from_raw_parts_mut(sk_out, SEED_LEN).copy_from_slice(&sk_bytes);
            core::slice::from_raw_parts_mut(vk_out, VK_LEN).copy_from_slice(&vk_bytes);
            0
        }
        Err(_) => -4,
    }
}

#[no_mangle]
pub unsafe extern "C" fn qv_wasm_sign(
    sk: *const u8, sk_len: u32,
    msg: *const u8, msg_len: u32,
    sig_out: *mut u8,
) -> i32 {
    if sk_len as usize != SEED_LEN { return -3; }
    let sk_bytes = core::slice::from_raw_parts(sk, SEED_LEN);
    let msg_buf  = core::slice::from_raw_parts(msg, msg_len as usize);
    let signing  = match QVSigningKey::from_bytes(sk_bytes) {
        Ok(s) => s, Err(_) => return -4,
    };
    match engine::sign(&signing, msg_buf) {
        Ok(sig) => {
            core::slice::from_raw_parts_mut(sig_out, SIG_LEN).copy_from_slice(&sig);
            0
        }
        Err(_) => -4,
    }
}

#[no_mangle]
pub unsafe extern "C" fn qv_wasm_verify(
    vk: *const u8, vk_len: u32,
    msg: *const u8, msg_len: u32,
    sig: *const u8, sig_len: u32,
) -> i32 {
    if vk_len as usize != VK_LEN || sig_len as usize != SIG_LEN { return -3; }
    let vk_bytes  = core::slice::from_raw_parts(vk, VK_LEN);
    let msg_buf   = core::slice::from_raw_parts(msg, msg_len as usize);
    let sig_bytes = core::slice::from_raw_parts(sig, SIG_LEN);
    let verifying = match QVVerifyingKey::from_bytes(vk_bytes) {
        Ok(v) => v, Err(_) => return -4,
    };
    match engine::verify(&verifying, msg_buf, sig_bytes) {
        Ok(()) => 1,
        Err(_) => 0,
    }
}
