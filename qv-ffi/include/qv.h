/*
 * QuantumVault — C ABI header
 * ===========================
 * ABI version 2. Generated from qv-ffi/src/lib.rs.
 * v2 adds Falcon-512 / Falcon-1024 alongside ML-DSA-87.
 *
 *   Link:    -lqv  (or qv.dll on Windows)
 *   Include: #include "qv.h"
 *
 * All functions are pure: no global state, no handles.
 * Caller owns every buffer.
 */
#ifndef QV_H
#define QV_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Return codes */
#define QV_OK                 0
#define QV_ERR_NULL_PTR      -1
#define QV_ERR_BUF_TOO_SMALL -2
#define QV_ERR_BAD_LEN       -3
#define QV_ERR_CRYPTO        -4
#define QV_ERR_INTERNAL      -99

/* Sizes (constants — exposed as functions for ABI stability) */
uint32_t qv_vk_len(void);    /* 2592 */
uint32_t qv_sk_len(void);    /*   32 */
uint32_t qv_sig_len(void);   /* 4627 */
uint32_t qv_abi_version(void);

/* Key generation. sk_out must be 32 B, vk_out must be 2592 B. */
int32_t qv_keygen(
    uint8_t *sk_out, uint32_t sk_out_len,
    uint8_t *vk_out, uint32_t vk_out_len);

/* Sign msg with sk (32-byte seed). sig_out must be ≥ 4627 B. */
int32_t qv_sign(
    const uint8_t *sk,  uint32_t sk_len,
    const uint8_t *msg, uint32_t msg_len,
    uint8_t       *sig_out, uint32_t sig_cap);

/* Verify sig over msg with vk. Returns 1 if valid, 0 if invalid, <0 on error. */
int32_t qv_verify(
    const uint8_t *vk,  uint32_t vk_len,
    const uint8_t *msg, uint32_t msg_len,
    const uint8_t *sig, uint32_t sig_len);

/* ------------------------------------------------------------------
 * Falcon-512  (sig ~666 B max, vk 897 B, sk 1281 B)
 * Signatures are variable-length — pass the actual length at verify.
 * ------------------------------------------------------------------ */
uint32_t qv_falcon512_vk_len(void);       /*  897 */
uint32_t qv_falcon512_sk_len(void);       /* 1281 */
uint32_t qv_falcon512_sig_max_len(void);  /*  666 */

int32_t qv_falcon512_keygen(
    uint8_t *sk_out, uint32_t sk_out_len,
    uint8_t *vk_out, uint32_t vk_out_len);

int32_t qv_falcon512_sign(
    const uint8_t *sk,  uint32_t sk_len,
    const uint8_t *msg, uint32_t msg_len,
    uint8_t       *sig_out, uint32_t sig_cap,
    uint32_t      *sig_len_out);

int32_t qv_falcon512_verify(
    const uint8_t *vk,  uint32_t vk_len,
    const uint8_t *msg, uint32_t msg_len,
    const uint8_t *sig, uint32_t sig_len);

/* ------------------------------------------------------------------
 * Falcon-1024 (sig ~1280 B max, vk 1793 B, sk 2305 B)
 * ------------------------------------------------------------------ */
uint32_t qv_falcon1024_vk_len(void);       /* 1793 */
uint32_t qv_falcon1024_sk_len(void);       /* 2305 */
uint32_t qv_falcon1024_sig_max_len(void);  /* 1280 */

int32_t qv_falcon1024_keygen(
    uint8_t *sk_out, uint32_t sk_out_len,
    uint8_t *vk_out, uint32_t vk_out_len);

int32_t qv_falcon1024_sign(
    const uint8_t *sk,  uint32_t sk_len,
    const uint8_t *msg, uint32_t msg_len,
    uint8_t       *sig_out, uint32_t sig_cap,
    uint32_t      *sig_len_out);

int32_t qv_falcon1024_verify(
    const uint8_t *vk,  uint32_t vk_len,
    const uint8_t *msg, uint32_t msg_len,
    const uint8_t *sig, uint32_t sig_len);

#ifdef __cplusplus
} /* extern "C" */
#endif
#endif /* QV_H */
