// QuantumVault v3.0 — Go SDK
// ===========================
// No external dependencies — uses only stdlib net/http + encoding/json.
//
// Compatible with: Go 1.18+, standard library only.
//
// Usage:
//   qv := quantumvault.NewClient("http://localhost:7433")
//   keyId, _ := qv.Keygen("go-demo")
//   token, _ := qv.Issue(keyId, map[string]string{"sub":"user-1","role":"admin"})
//   result, _ := qv.Verify(keyId, token)
//   fmt.Println(result.Claims)

package quantumvault

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Client is the QuantumVault REST client.
type Client struct {
	BaseURL    string
	HTTPClient *http.Client
}

// NewClient creates a new QuantumVault client.
func NewClient(baseURL string) *Client {
	return &Client{
		BaseURL: baseURL,
		HTTPClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// ── Response types ────────────────────────────────────────────────────────────

type KeygenResponse struct {
	KeyID           string `json:"keyId"`
	Label           string `json:"label"`
	VerifyingKeyB64 string `json:"verifyingKeyB64"`
	EncryptKeyB64   string `json:"encryptKeyB64"`
	Algorithm       string `json:"algorithm"`
	CreatedAt       string `json:"createdAt"`
}

type IssueResponse struct {
	TokenHex    string `json:"tokenHex"`
	TokenB64    string `json:"tokenB64"`
	SizeBytes   int    `json:"sizeBytes"`
	IssuedAt    string `json:"issuedAt"`
	TTLSecs     int    `json:"ttlSecs"`
	MutationCtr int64  `json:"mutationCtr"`
	Suite       string `json:"suite"`
	TokenType   string `json:"tokenType"`
}

type VerifyResponse struct {
	Valid       bool              `json:"valid"`
	Claims      map[string]string `json:"claims"`
	IssuedAt    string            `json:"issuedAt"`
	TTLSecs     int               `json:"ttlSecs"`
	MutationCtr int64             `json:"mutationCtr"`
}

type HealthResponse struct {
	Status    string `json:"status"`
	Version   string `json:"version"`
	Algorithm string `json:"algorithm"`
}

// ── Internal HTTP helper ──────────────────────────────────────────────────────

func (c *Client) post(path string, body any, out any) error {
	b, _ := json.Marshal(body)
	resp, err := c.HTTPClient.Post(c.BaseURL+path, "application/json", bytes.NewReader(b))
	if err != nil {
		return fmt.Errorf("http post: %w", err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		var e struct{ Error struct{ Code, Message string } `json:"error"` }
		json.Unmarshal(data, &e)
		return fmt.Errorf("[%s] %s", e.Error.Code, e.Error.Message)
	}
	return json.Unmarshal(data, out)
}

func (c *Client) get(path string, out any) error {
	resp, err := c.HTTPClient.Get(c.BaseURL + path)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	return json.Unmarshal(data, out)
}

// ── API ───────────────────────────────────────────────────────────────────────

func (c *Client) Health() (*HealthResponse, error) {
	var out HealthResponse
	return &out, c.get("/v3/health", &out)
}

// Keygen generates a new ML-DSA-87 keypair. Returns keyId.
func (c *Client) Keygen(label string) (string, error) {
	body := map[string]string{"label": label}
	var out KeygenResponse
	if err := c.post("/v3/keygen", body, &out); err != nil {
		return "", err
	}
	return out.KeyID, nil
}

// Issue signs a new token with the given keyId and claims.
func (c *Client) Issue(keyID string, claims map[string]string) (*IssueResponse, error) {
	return c.IssueWithOptions(keyID, claims, 3600, "dilithium5", "access")
}

func (c *Client) IssueWithOptions(keyID string, claims map[string]string, ttl int, suite, tokenType string) (*IssueResponse, error) {
	body := map[string]any{
		"keyId":     keyID,
		"claims":    claims,
		"ttl":       ttl,
		"suite":     suite,
		"tokenType": tokenType,
	}
	var out IssueResponse
	return &out, c.post("/v3/token/issue", body, &out)
}

// Verify verifies a token. Returns claims on success, error on failure.
func (c *Client) Verify(keyID, token string) (*VerifyResponse, error) {
	body := map[string]string{"keyId": keyID, "token": token}
	var out VerifyResponse
	if err := c.post("/v3/token/verify", body, &out); err != nil {
		return nil, err
	}
	if !out.Valid {
		return nil, fmt.Errorf("token invalid")
	}
	return &out, nil
}

// Inspect returns the token header without cryptographic verification.
func (c *Client) Inspect(token string) (map[string]any, error) {
	body := map[string]string{"token": token}
	var out map[string]any
	return out, c.post("/v3/token/inspect", body, &out)
}
