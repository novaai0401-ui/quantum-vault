"""
Sigvault v3.0 — Python SDK
================================
pip install requests   # only dependency

Works with Python 3.8+ on Windows, macOS, Linux, ARM, RISC-V — anywhere Python runs.
Talks to the Sigvault REST API server over HTTP.

Usage:
    from sigvault import SigvaultClient
    qv  = SigvaultClient("http://localhost:7433")
    key = qv.keygen(label="my-service")
    tok = qv.issue(key["keyId"], {"sub": "user-1", "role": "admin"})
    out = qv.verify(key["keyId"], tok["tokenHex"])
    print(out["claims"])   # {'sub': 'user-1', 'role': 'admin'}
"""

import requests
import json
from typing import Optional, Dict, Any


class SigvaultError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(f"[{code}] {message}")
        self.code = code


class SigvaultClient:
    """Thread-safe HTTP client for the Sigvault REST API."""

    def __init__(self, base_url: str = "http://localhost:7433", timeout: int = 30):
        self.base  = base_url.rstrip("/")
        self.timeout = timeout
        self._session = requests.Session()
        self._session.headers.update({
            "Content-Type": "application/json",
            "Accept":       "application/json",
        })

    # ── Low-level ─────────────────────────────────────────────────────────────

    def _post(self, path: str, body: Dict) -> Dict:
        resp = self._session.post(f"{self.base}{path}", json=body, timeout=self.timeout)
        data = resp.json()
        if not resp.ok:
            err = data.get("error", {})
            raise SigvaultError(err.get("code", "UNKNOWN"), err.get("message", str(resp.status_code)))
        return data

    def _get(self, path: str) -> Dict:
        resp = self._session.get(f"{self.base}{path}", timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    # ── API ───────────────────────────────────────────────────────────────────

    def health(self) -> Dict:
        """Check server liveness."""
        return self._get("/v3/health")

    def spec(self) -> Dict:
        """Get algorithm and wire-format specification."""
        return self._get("/v3/spec")

    def keygen(self, label: Optional[str] = None) -> Dict:
        """
        Generate a new ML-DSA-87 keypair on the server.

        Returns:
            {
                keyId: str,             # reference ID — use in all other calls
                verifyingKeyB64: str,   # base64url public key (2592 bytes)
                encryptKeyB64:   str,   # base64url symmetric key
                algorithm:       str,
                createdAt:       str,
            }
        """
        body = {}
        if label:
            body["label"] = label
        return self._post("/v3/keygen", body)

    def issue(
        self,
        key_id:     str,
        claims:     Dict[str, str],
        ttl:        int = 3600,
        suite:      str = "dilithium5",   # dilithium5 | dual | triple
        token_type: str = "access",       # access | refresh | service
    ) -> Dict:
        """
        Issue a new post-quantum signed token.

        Args:
            key_id:     keyId from keygen()
            claims:     dict of string key-value pairs (e.g. {"sub":"user-1","role":"admin"})
            ttl:        time-to-live in seconds (default 3600)
            suite:      cryptographic suite
            token_type: token purpose

        Returns:
            {
                tokenHex:    str,   # hex-encoded token (pass to verify/inspect)
                tokenB64:    str,   # base64url token
                sizeBytes:   int,   # ~4826 bytes for dilithium5
                issuedAt:    str,   # ISO 8601
                ttlSecs:     int,
                mutationCtr: int,
            }
        """
        return self._post("/v3/token/issue", {
            "keyId":     key_id,
            "claims":    claims,
            "ttl":       ttl,
            "suite":     suite,
            "tokenType": token_type,
        })

    def verify(self, key_id: str, token: str) -> Dict:
        """
        Verify a token through the 7-layer pipeline.

        Args:
            key_id: keyId used to issue the token
            token:  hex or base64url token string

        Returns:
            {
                valid:       True,
                claims:      dict,
                issuedAt:    str,
                ttlSecs:     int,
                mutationCtr: int,
            }

        Raises:
            SigvaultError if the token is invalid, expired, or tampered.
        """
        return self._post("/v3/token/verify", {"keyId": key_id, "token": token})

    def inspect(self, token: str) -> Dict:
        """
        Inspect a token's header without cryptographic verification.
        Useful for debugging or routing decisions.
        """
        return self._post("/v3/token/inspect", {"token": token})


# ── Demo ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys, time

    SERVER = "http://localhost:7433"
    qv = SigvaultClient(SERVER)

    print("\n╔══════════════════════════════════════════╗")
    print("║  Sigvault v3.0 — Python SDK Demo     ║")
    print("╚══════════════════════════════════════════╝\n")

    # Health check
    h = qv.health()
    print(f"✔ Server: {h['status']} | {h['algorithm']}")

    # Keygen
    print("\n[1] Generating ML-DSA-87 keypair...")
    t = time.time()
    key = qv.keygen(label="python-demo")
    print(f"  ✔ keyId   : {key['keyId']}")
    print(f"  ✔ vk size : {key['verifyingKeyLen']} bytes")
    print(f"  ✔ time    : {(time.time()-t)*1000:.1f}ms")

    # Issue
    print("\n[2] Issuing access token...")
    t = time.time()
    tok = qv.issue(key["keyId"], {
        "sub":  "python-user-001",
        "iss":  "qv.python.example",
        "role": "data-scientist",
        "lang": "Python 3",
    })
    print(f"  ✔ size       : {tok['sizeBytes']} bytes")
    print(f"  ✔ issuedAt   : {tok['issuedAt']}")
    print(f"  ✔ mutationCtr: {tok['mutationCtr']}")
    print(f"  ✔ token      : {tok['tokenHex'][:32]}...")
    print(f"  ✔ time       : {(time.time()-t)*1000:.1f}ms")

    # Inspect
    print("\n[3] Inspecting token header...")
    info = qv.inspect(tok["tokenHex"])
    for k, v in info.items():
        print(f"  {k:<16}: {v}")

    # Verify
    print("\n[4] Verifying token...")
    t = time.time()
    out = qv.verify(key["keyId"], tok["tokenHex"])
    print(f"  ✔ VALID in {(time.time()-t)*1000:.1f}ms")
    print(f"  ✔ Claims:")
    for k, v in out["claims"].items():
        print(f"      {k} = {v}")

    # Attack test: tamper
    print("\n[5] Attack resistance...")
    bad_token = tok["tokenHex"][:-4] + "dead"   # corrupt last 2 bytes
    try:
        qv.verify(key["keyId"], bad_token)
        print("  ✘ Should have rejected tampered token!")
        sys.exit(1)
    except SigvaultError as e:
        print(f"  ✔ Tampered token rejected: {e}")

    print("\n╔══════════════════════════════════════════╗")
    print("║  Python SDK — ALL TESTS PASSED ✔         ║")
    print("╚══════════════════════════════════════════╝\n")
