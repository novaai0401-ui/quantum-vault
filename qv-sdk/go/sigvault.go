// Sigvault — Go SDK
// ===================================
// Single-file, stdlib-only Go client for the Sigvault REST API.
//
// Compatible with: Go 1.18+. Pure stdlib (net/http, encoding/json).
// No third-party imports — `dep-audit` rejects any change that adds them.
//
// Quick start:
//
//   c := sigvault.NewClient("http://localhost:7433").WithAdminToken(os.Getenv("QV_ADMIN_TOKEN"))
//   keyId, _ := c.Keygen("go-demo")
//   res, _   := c.Issue(keyId, map[string]any{"sub":"alice","role":"admin"})
//   v, _     := c.Verify(keyId, res.TokenHex)
//   fmt.Println(v.Claims)
//
// SPDX-License-Identifier: Apache-2.0

package sigvault

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// ── Client ────────────────────────────────────────────────────────────────────

type Client struct {
	BaseURL    string
	HTTPClient *http.Client
	adminToken string
}

func NewClient(baseURL string) *Client {
	return &Client{
		BaseURL:    baseURL,
		HTTPClient: &http.Client{Timeout: 30 * time.Second},
	}
}

// WithAdminToken returns the client with the admin bearer token attached for
// admin-only endpoints (/v3/keygen, /v3/token/issue, DELETE /v3/keys/{id}).
func (c *Client) WithAdminToken(token string) *Client {
	c.adminToken = token
	return c
}

// ── Errors ────────────────────────────────────────────────────────────────────

type Error struct {
	Status  int    `json:"-"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *Error) Error() string {
	return fmt.Sprintf("sigvault: [%d %s] %s", e.Status, e.Code, e.Message)
}

func decodeError(status int, body []byte) error {
	var env struct {
		Error Error `json:"error"`
	}
	if err := json.Unmarshal(body, &env); err == nil && env.Error.Code != "" {
		env.Error.Status = status
		return &env.Error
	}
	return &Error{Status: status, Code: "HTTP_" + http.StatusText(status), Message: string(body)}
}

// ── Response types ───────────────────────────────────────────────────────────

type KeygenResponse struct {
	KeyID           string `json:"keyId"`
	Label           string `json:"label"`
	VerifyingKeyB64 string `json:"verifyingKeyB64"`
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
	Valid       bool                   `json:"valid"`
	KeyID       string                 `json:"keyId,omitempty"` // populated by VerifyAuto
	Claims      map[string]any         `json:"claims"`
	IssuedAt    string                 `json:"issuedAt"`
	TTLSecs     int                    `json:"ttlSecs"`
	MutationCtr int64                  `json:"mutationCtr"`
}

type IdentifyResponse struct {
	KeyID       string `json:"keyId"`
	Fingerprint string `json:"fingerprint"`
	Revoked     bool   `json:"revoked"`
}

type HealthResponse struct {
	Status    string `json:"status"`
	Version   string `json:"version"`
	Algorithm string `json:"algorithm"`
}

// ── Internal helpers ─────────────────────────────────────────────────────────

func (c *Client) do(ctx context.Context, method, path string, body any, admin bool, out any) error {
	var rdr io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, rdr)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if admin {
		if c.adminToken == "" {
			return errors.New("sigvault: admin token required for " + path + " — call WithAdminToken first")
		}
		req.Header.Set("Authorization", "Bearer "+c.adminToken)
	}
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("sigvault: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return decodeError(resp.StatusCode, raw)
	}
	if out == nil || len(raw) == 0 {
		return nil
	}
	return json.Unmarshal(raw, out)
}

// ── Health / spec ────────────────────────────────────────────────────────────

func (c *Client) Health(ctx context.Context) (*HealthResponse, error) {
	var out HealthResponse
	return &out, c.do(ctx, "GET", "/v3/health", nil, false, &out)
}

func (c *Client) Live(ctx context.Context) error {
	return c.do(ctx, "GET", "/v3/live", nil, false, nil)
}

func (c *Client) Ready(ctx context.Context) error {
	return c.do(ctx, "GET", "/v3/ready", nil, false, nil)
}

// ── Keys ─────────────────────────────────────────────────────────────────────

func (c *Client) Keygen(ctx context.Context, label string) (string, error) {
	var out KeygenResponse
	body := map[string]string{"label": label}
	if err := c.do(ctx, "POST", "/v3/keygen", body, true, &out); err != nil {
		return "", err
	}
	return out.KeyID, nil
}

// IdentifyByVK resolves keyId in O(1) from a verifying-key (base64url).
// Closes limitation L2 operationally — a caller that has a token but no
// keyId can call this once and cache the result.
func (c *Client) IdentifyByVK(ctx context.Context, vkB64u string) (*IdentifyResponse, error) {
	var out IdentifyResponse
	body := map[string]string{"vkB64u": vkB64u}
	return &out, c.do(ctx, "POST", "/v3/keys/identify", body, false, &out)
}

func (c *Client) IdentifyByFingerprint(ctx context.Context, fp string) (*IdentifyResponse, error) {
	var out IdentifyResponse
	body := map[string]string{"fingerprint": fp}
	return &out, c.do(ctx, "POST", "/v3/keys/identify", body, false, &out)
}

// Revoke (admin) marks a key revoked. Durable on disk before returning.
func (c *Client) Revoke(ctx context.Context, keyID string) error {
	return c.do(ctx, "DELETE", "/v3/keys/"+keyID, nil, true, nil)
}

// ── Tokens ───────────────────────────────────────────────────────────────────

func (c *Client) Issue(ctx context.Context, keyID string, claims map[string]any) (*IssueResponse, error) {
	return c.IssueWithOptions(ctx, keyID, claims, 3600, "dilithium5", "access")
}

func (c *Client) IssueWithOptions(ctx context.Context, keyID string, claims map[string]any, ttl int, suite, tokenType string) (*IssueResponse, error) {
	var out IssueResponse
	body := map[string]any{
		"keyId":     keyID,
		"claims":    claims,
		"ttl":       ttl,
		"suite":     suite,
		"tokenType": tokenType,
	}
	return &out, c.do(ctx, "POST", "/v3/token/issue", body, true, &out)
}

func (c *Client) Verify(ctx context.Context, keyID, tokenHex string) (*VerifyResponse, error) {
	var out VerifyResponse
	body := map[string]string{"keyId": keyID, "token": tokenHex}
	if err := c.do(ctx, "POST", "/v3/token/verify", body, false, &out); err != nil {
		return nil, err
	}
	if !out.Valid {
		return nil, &Error{Code: "TOKEN_INVALID", Message: "verify returned valid=false"}
	}
	return &out, nil
}

// VerifyAuto verifies without requiring the caller to know the keyId. The
// server trial-verifies against every active (non-revoked) key.
// Operationally closes L2.
func (c *Client) VerifyAuto(ctx context.Context, tokenHex string) (*VerifyResponse, error) {
	var out VerifyResponse
	body := map[string]string{"token": tokenHex}
	if err := c.do(ctx, "POST", "/v3/token/verify-auto", body, false, &out); err != nil {
		return nil, err
	}
	if !out.Valid {
		return nil, &Error{Code: "NO_KEY_MATCHED", Message: "no active key verified the token"}
	}
	return &out, nil
}

func (c *Client) Inspect(ctx context.Context, tokenHex string) (map[string]any, error) {
	var out map[string]any
	body := map[string]string{"token": tokenHex}
	return out, c.do(ctx, "POST", "/v3/token/inspect", body, false, &out)
}
