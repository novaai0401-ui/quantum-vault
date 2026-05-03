// go run main_demo.go sigvault.go
//
// SPDX-License-Identifier: Apache-2.0
package sigvault

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"
)

// RunDemo end-to-ends the Go SDK against a running qv-server.
// Set QV_BASE (default http://127.0.0.1:7433) and QV_ADMIN_TOKEN before
// running.
func RunDemo() {
	base := os.Getenv("QV_BASE")
	if base == "" {
		base = "http://127.0.0.1:7433"
	}
	admin := os.Getenv("QV_ADMIN_TOKEN")
	if admin == "" {
		log.Fatal("QV_ADMIN_TOKEN must be set (admin endpoints require it)")
	}

	c := NewClient(base).WithAdminToken(admin)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	fmt.Println("Sigvault — Go SDK demo")
	fmt.Println("server: " + base)
	fmt.Println()

	// Health
	if h, err := c.Health(ctx); err != nil {
		log.Fatalf("health: %v", err)
	} else {
		fmt.Printf("[1] health: %s | %s\n", h.Status, h.Algorithm)
	}

	// Keygen
	t0 := time.Now()
	keyID, err := c.Keygen(ctx, "go-demo")
	if err != nil {
		log.Fatalf("keygen: %v", err)
	}
	fmt.Printf("[2] keygen: %s (in %dms)\n", keyID, time.Since(t0).Milliseconds())

	// Issue
	t1 := time.Now()
	res, err := c.Issue(ctx, keyID, map[string]any{
		"sub":  "go-user-001",
		"role": "microservice",
		"lang": "Go",
	})
	if err != nil {
		log.Fatalf("issue: %v", err)
	}
	fmt.Printf("[3] issue: %d-byte token (in %dms)\n", res.SizeBytes, time.Since(t1).Milliseconds())

	// Verify (caller knows keyId)
	t2 := time.Now()
	v, err := c.Verify(ctx, keyID, res.TokenHex)
	if err != nil {
		log.Fatalf("verify: %v", err)
	}
	fmt.Printf("[4] verify: VALID (in %dms) — claims=%v\n",
		time.Since(t2).Milliseconds(), v.Claims)

	// Issue another token, then verify-auto without supplying keyId
	res2, err := c.Issue(ctx, keyID, map[string]any{"sub": "auto-id-probe"})
	if err != nil {
		log.Fatalf("issue#2: %v", err)
	}
	t3 := time.Now()
	va, err := c.VerifyAuto(ctx, res2.TokenHex)
	if err != nil {
		log.Fatalf("verify-auto: %v", err)
	}
	fmt.Printf("[5] verify-auto: VALID (resolved keyId=%s in %dms)\n",
		va.KeyID, time.Since(t3).Milliseconds())

	// Tamper test
	bad := res2.TokenHex[:len(res2.TokenHex)-4] + "dead"
	if _, err := c.Verify(ctx, keyID, bad); err == nil {
		log.Fatal("[6] tampered token NOT rejected — that's a bug")
	} else {
		fmt.Printf("[6] tampered token rejected: %v\n", err)
	}

	fmt.Println()
	fmt.Println("Go SDK — all demo steps passed ✔")
}
