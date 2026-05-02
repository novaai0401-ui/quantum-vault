"""
Stdlib-only HTTP client for the Sigvault REST server.

No third-party dependencies. Works on any Python 3.8+ on any platform
(Linux, macOS, Windows, WASM) without compiled wheels.
"""
from __future__ import annotations

import json as _json
import ssl
import urllib.error
import urllib.request
from typing import Any, Dict, Optional


class QVError(Exception):
    """Base class for all sigvault errors."""


class QVHTTPError(QVError):
    """The server returned a non-2xx response."""

    def __init__(self, status: int, code: str, message: str, body: Any = None):
        super().__init__(f"{status} {code}: {message}")
        self.status = status
        self.code = code
        self.message = message
        self.body = body


class QVVerifyError(QVError):
    """Token verification failed (signature, expiry, replay, etc.)."""


class QVClient:
    """
    Thin REST client for a Sigvault server.

    Parameters
    ----------
    base_url : str
        e.g. ``http://localhost:7433`` or ``https://vault.example.com``.
    timeout : float
        Per-request timeout in seconds. Default 10.
    verify_tls : bool
        Whether to verify TLS certificates. Default True. Set to False
        only for local development.
    default_headers : dict, optional
        Headers to attach to every request (e.g. ``Authorization`` for
        a reverse proxy that gates the vault).
    """

    def __init__(
        self,
        base_url: str,
        *,
        timeout: float = 10.0,
        verify_tls: bool = True,
        default_headers: Optional[Dict[str, str]] = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._headers = dict(default_headers or {})
        if verify_tls:
            self._ssl = ssl.create_default_context()
        else:
            self._ssl = ssl._create_unverified_context()  # noqa: SLF001

    # ─── low-level ────────────────────────────────────────────────────────
    def _request(self, method: str, path: str, body: Optional[dict] = None) -> Any:
        url = f"{self.base_url}{path}"
        data = None if body is None else _json.dumps(body).encode("utf-8")
        headers = {"accept": "application/json"}
        if data is not None:
            headers["content-type"] = "application/json"
        headers.update(self._headers)
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout, context=self._ssl) as resp:
                raw = resp.read()
                ctype = resp.headers.get("content-type", "")
                if "application/json" in ctype:
                    return _json.loads(raw.decode("utf-8")) if raw else None
                return raw
        except urllib.error.HTTPError as e:
            raw = e.read()
            payload: Any = None
            try:
                payload = _json.loads(raw.decode("utf-8"))
            except Exception:
                payload = raw
            code = (payload or {}).get("code", "HTTP_ERROR") if isinstance(payload, dict) else "HTTP_ERROR"
            msg = (payload or {}).get("message", str(e)) if isinstance(payload, dict) else str(e)
            raise QVHTTPError(e.code, code, msg, payload) from None
        except urllib.error.URLError as e:
            raise QVError(f"network error reaching {url}: {e.reason}") from None

    # ─── high-level ───────────────────────────────────────────────────────
    def health(self) -> Dict[str, Any]:
        """GET /v3/health — liveness + version + algorithm info."""
        return self._request("GET", "/v3/health")

    def spec(self) -> Dict[str, Any]:
        """GET /v3/spec — machine-readable capability document."""
        return self._request("GET", "/v3/spec")

    def keygen(self, label: Optional[str] = None) -> Dict[str, Any]:
        """POST /v3/keygen — create a new ML-DSA-87 keypair on the server."""
        return self._request("POST", "/v3/keygen", {"label": label} if label else {})

    def keys(self) -> Dict[str, Any]:
        """GET /v3/keys — list all keypairs (JWKS-equivalent)."""
        return self._request("GET", "/v3/keys")

    def revoked(self) -> Dict[str, Any]:
        """GET /v3/revoked — list of revoked keyIds."""
        return self._request("GET", "/v3/revoked")

    def issue(
        self,
        *,
        key_id: str,
        claims: Dict[str, Any],
        ttl: int = 3600,
        suite: str = "dilithium5",
        token_type: str = "access",
    ) -> Dict[str, Any]:
        """
        POST /v3/token/issue — mint a signed, encrypted, replay-protected token.

        Returns a dict including ``token`` (hex-encoded wire bytes) and the
        issued claims echoed back.
        """
        return self._request(
            "POST",
            "/v3/token/issue",
            {
                "keyId": key_id,
                "claims": claims,
                "ttl": ttl,
                "suite": suite,
                "tokenType": token_type,
            },
        )

    def verify(self, *, key_id: str, token: str) -> Dict[str, Any]:
        """
        POST /v3/token/verify — verify signature, expiry, and chain counter.

        Raises
        ------
        QVVerifyError
            If the server rejects the token (bad signature, expired,
            replayed, revoked key, etc.).
        QVHTTPError
            For non-verification HTTP errors (e.g. 400 on bad input).
        """
        try:
            return self._request(
                "POST", "/v3/token/verify", {"keyId": key_id, "token": token}
            )
        except QVHTTPError as e:
            # Surface verification-semantic failures as a distinct type so
            # callers can try/except narrowly.
            if e.status in (400, 401, 403) and e.code.startswith(
                ("VERIFY_", "EXPIRED", "REPLAY", "BAD_SIG", "REVOKED")
            ):
                raise QVVerifyError(e.message) from None
            raise

    def inspect(self, token: str) -> Dict[str, Any]:
        """POST /v3/token/inspect — decode header without verifying."""
        return self._request("POST", "/v3/token/inspect", {"token": token})
