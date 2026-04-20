// QuantumVault v4.0 - Go cgo Demo
// =================================
// Calls qv.dll directly via cgo. NO HTTP. NO external modules.
//
// Build (Windows):
//   set CGO_CFLAGS=-I../../include
//   set CGO_LDFLAGS=-L../../../target/release -lqv
//   copy ..\..\..\target\release\qv.dll .
//   go build -o demo.exe demo.go && demo.exe
//
// Build (Linux/macOS):
//   CGO_CFLAGS="-I../../include" \
//   CGO_LDFLAGS="-L../../../target/release -lqv" \
//   go build -o demo demo.go && ./demo

package main

/*
#cgo CFLAGS: -I../../include
#cgo LDFLAGS: -L../../../target/release -lqv
#include "qv.h"
*/
import "C"

import (
	"fmt"
	"time"
	"unsafe"
)

func main() {
	fmt.Println("\n================================================")
	fmt.Println("  QuantumVault v4.0 -- Go cgo Demo")
	fmt.Println("  cgo | NO HTTP | stdlib only")
	fmt.Println("================================================")
	fmt.Printf("ABI version: %d\n", C.qv_abi_version())
	skLen, vkLen, sigLen := C.qv_sk_len(), C.qv_vk_len(), C.qv_sig_len()
	fmt.Printf("Sizes      : sk=%d vk=%d sig=%d\n\n", skLen, vkLen, sigLen)

	sk  := make([]byte, skLen)
	vk  := make([]byte, vkLen)
	sig := make([]byte, sigLen)
	msg := []byte("QuantumVault sovereign -- Go says hi")

	// [1] Keygen
	t := time.Now()
	if rc := C.qv_keygen((*C.uint8_t)(&sk[0]), skLen, (*C.uint8_t)(&vk[0]), vkLen); rc != 0 {
		panic(fmt.Sprintf("keygen rc=%d", rc))
	}
	fmt.Printf("[1] Keygen : %6.2f ms   vk[0:4]=%02x%02x%02x%02x\n",
		float64(time.Since(t).Microseconds())/1000, vk[0], vk[1], vk[2], vk[3])

	// [2] Sign
	t = time.Now()
	rc := C.qv_sign((*C.uint8_t)(&sk[0]), skLen,
		(*C.uint8_t)(unsafe.Pointer(&msg[0])), C.uint32_t(len(msg)),
		(*C.uint8_t)(&sig[0]), sigLen)
	if rc != 0 { panic(fmt.Sprintf("sign rc=%d", rc)) }
	fmt.Printf("[2] Sign   : %6.2f ms\n", float64(time.Since(t).Microseconds())/1000)

	// [3] Verify
	t = time.Now()
	rc = C.qv_verify((*C.uint8_t)(&vk[0]), vkLen,
		(*C.uint8_t)(unsafe.Pointer(&msg[0])), C.uint32_t(len(msg)),
		(*C.uint8_t)(&sig[0]), sigLen)
	if rc != 1 { panic(fmt.Sprintf("verify rc=%d", rc)) }
	fmt.Printf("[3] Verify : %6.2f ms   VALID [OK]\n", float64(time.Since(t).Microseconds())/1000)

	// [4] Tamper
	sig[100] ^= 0xFF
	rc = C.qv_verify((*C.uint8_t)(&vk[0]), vkLen,
		(*C.uint8_t)(unsafe.Pointer(&msg[0])), C.uint32_t(len(msg)),
		(*C.uint8_t)(&sig[0]), sigLen)
	if rc != 0 { panic("tamper not rejected") }
	sig[100] ^= 0xFF
	fmt.Println("[4] Tamper :    -      REJECTED [OK]")

	// [5] Bench
	const N = 100
	t = time.Now()
	for i := 0; i < N; i++ {
		C.qv_verify((*C.uint8_t)(&vk[0]), vkLen,
			(*C.uint8_t)(unsafe.Pointer(&msg[0])), C.uint32_t(len(msg)),
			(*C.uint8_t)(&sig[0]), sigLen)
	}
	dur := float64(time.Since(t).Microseconds()) / 1000
	fmt.Printf("[5] Bench  : %d verifies in %.1f ms -> %.2f ms/verify (%.0f/s)\n",
		N, dur, dur/N, N/dur*1000)

	fmt.Println("\n================================================")
	fmt.Println("  Go cgo -- ALL TESTS PASSED [OK]")
	fmt.Println("================================================")
}
