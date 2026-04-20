/*
 * QuantumVault v4.0 - C FFI Demo
 * ================================
 * Pure C. No runtime. No HTTP. Links qv.dll directly via qv.h.
 *
 * Build (Windows, MinGW GCC):
 *   gcc -I../../include demo.c -L../../../target/release -lqv -o demo.exe
 *
 * Build (Linux/macOS):
 *   gcc -I../../include demo.c -L../../../target/release -lqv -o demo
 */
#include <stdio.h>
#include <string.h>
#include <time.h>
#include "qv.h"

static double ms_since(struct timespec *t0) {
    struct timespec t1; clock_gettime(CLOCK_MONOTONIC, &t1);
    return (t1.tv_sec - t0->tv_sec) * 1000.0 + (t1.tv_nsec - t0->tv_nsec) / 1e6;
}

int main(void) {
    printf("\n================================================\n");
    printf("  QuantumVault v4.0 -- C FFI Demo\n");
    printf("  qv.h + qv.dll | NO HTTP | pure C\n");
    printf("================================================\n\n");
    printf("ABI version: %u\n", qv_abi_version());
    printf("Sizes      : sk=%u vk=%u sig=%u\n\n", qv_sk_len(), qv_vk_len(), qv_sig_len());

    uint8_t sk[32], vk[2592], sig[4627];
    const char *msg = "QuantumVault sovereign -- C says hi";
    uint32_t msg_len = (uint32_t)strlen(msg);
    struct timespec t;

    /* [1] Keygen */
    clock_gettime(CLOCK_MONOTONIC, &t);
    if (qv_keygen(sk, 32, vk, 2592) != QV_OK) { printf("keygen FAILED\n"); return 1; }
    printf("[1] Keygen : %6.2f ms   vk[0:4]=%02x%02x%02x%02x\n",
           ms_since(&t), vk[0], vk[1], vk[2], vk[3]);

    /* [2] Sign */
    clock_gettime(CLOCK_MONOTONIC, &t);
    if (qv_sign(sk, 32, (const uint8_t*)msg, msg_len, sig, 4627) != QV_OK) {
        printf("sign FAILED\n"); return 1;
    }
    printf("[2] Sign   : %6.2f ms   sig[0:4]=%02x%02x%02x%02x\n",
           ms_since(&t), sig[0], sig[1], sig[2], sig[3]);

    /* [3] Verify */
    clock_gettime(CLOCK_MONOTONIC, &t);
    int rc = qv_verify(vk, 2592, (const uint8_t*)msg, msg_len, sig, 4627);
    if (rc != 1) { printf("verify rc=%d FAILED\n", rc); return 1; }
    printf("[3] Verify : %6.2f ms   VALID [OK]\n", ms_since(&t));

    /* [4] Tamper */
    sig[100] ^= 0xFF;
    rc = qv_verify(vk, 2592, (const uint8_t*)msg, msg_len, sig, 4627);
    if (rc != 0) { printf("tamper not rejected (rc=%d) FAILED\n", rc); return 1; }
    sig[100] ^= 0xFF;
    printf("[4] Tamper :    -      REJECTED [OK]\n");

    /* [5] Bench */
    const int N = 100;
    clock_gettime(CLOCK_MONOTONIC, &t);
    for (int i = 0; i < N; i++) qv_verify(vk, 2592, (const uint8_t*)msg, msg_len, sig, 4627);
    double dur = ms_since(&t);
    printf("[5] Bench  : %d verifies in %.1f ms -> %.2f ms/verify (%.0f/s)\n",
           N, dur, dur/N, N/dur*1000);

    printf("\n================================================\n");
    printf("  C FFI -- ALL TESTS PASSED [OK]\n");
    printf("================================================\n\n");
    return 0;
}
