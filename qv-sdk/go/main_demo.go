// go run main_demo.go sigvault.go
package sigvault

import (
	"fmt"
	"log"
	"time"
)

func RunDemo() {
	qv := NewClient("http://localhost:7433")

	fmt.Println("\n╔══════════════════════════════════════════╗")
	fmt.Println("║  Sigvault v3.0 — Go SDK Demo         ║")
	fmt.Println("╚══════════════════════════════════════════╝\n")

	// Health
	h, err := qv.Health()
	if err != nil { log.Fatal(err) }
	fmt.Printf("✔ Server: %s | %s\n", h.Status, h.Algorithm)

	// Keygen
	fmt.Println("\n[1] Generating ML-DSA-87 keypair...")
	t0 := time.Now()
	keyID, err := qv.Keygen("go-demo")
	if err != nil { log.Fatal(err) }
	fmt.Printf("  ✔ keyId: %s\n", keyID)
	fmt.Printf("  ✔ time : %dms\n", time.Since(t0).Milliseconds())

	// Issue
	fmt.Println("\n[2] Issuing access token...")
	t1 := time.Now()
	resp, err := qv.Issue(keyID, map[string]string{
		"sub":  "go-user-001",
		"iss":  "qv.go.example",
		"role": "microservice",
		"lang": "Go",
	})
	if err != nil { log.Fatal(err) }
	fmt.Printf("  ✔ size  : %d bytes\n", resp.SizeBytes)
	fmt.Printf("  ✔ token : %s...\n", resp.TokenHex[:32])
	fmt.Printf("  ✔ time  : %dms\n", time.Since(t1).Milliseconds())

	// Verify
	fmt.Println("\n[3] Verifying token...")
	t2 := time.Now()
	out, err := qv.Verify(keyID, resp.TokenHex)
	if err != nil { log.Fatal(err) }
	fmt.Printf("  ✔ VALID in %dms\n", time.Since(t2).Milliseconds())
	fmt.Printf("  ✔ Claims: %v\n", out.Claims)

	// Tamper test
	fmt.Println("\n[4] Attack resistance...")
	bad := resp.TokenHex[:len(resp.TokenHex)-4] + "dead"
	_, err = qv.Verify(keyID, bad)
	if err != nil {
		fmt.Printf("  ✔ Tampered token rejected: %v\n", err)
	} else {
		log.Fatal("  ✘ Should have rejected tampered token!")
	}

	fmt.Println("\n╔══════════════════════════════════════════╗")
	fmt.Println("║  Go SDK — ALL TESTS PASSED ✔             ║")
	fmt.Println("╚══════════════════════════════════════════╝\n")
}
