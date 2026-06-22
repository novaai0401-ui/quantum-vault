"""
sigvault — Python client for the Sigvault REST server.

Sigvault issues post-quantum cryptographic tokens (ML-DSA-87, Falcon-512/1024)
over a zero-dependency REST API. This package is a thin, stdlib-only client for
that API.

Quick start
-----------

    from sigvault import QVClient

    qv = QVClient("http://localhost:7433")          # or point at your qv-server
    key = qv.keygen(label="demo")                   # → {"keyId": "...", ...}
    iss = qv.issue(
        key_id=key["keyId"],
        claims={"sub": "user-123", "role": "admin"},
        ttl=3600,
    )                                               # → {"token": "<hex>", ...}
    out = qv.verify(key_id=key["keyId"], token=iss["token"])
    assert out["claims"]["sub"] == "user-123"

Running the server
------------------

    docker run -p 7433:7433 \\
        -e QV_MASTER_KEY_HEX=$(openssl rand -hex 32) \\
        ghcr.io/novaai0401-ui/qv-server:4.2

or any binary / Node build of qv-server.
"""
from __future__ import annotations

from .client import QVClient, QVError, QVHTTPError, QVVerifyError

__all__ = ["QVClient", "QVError", "QVHTTPError", "QVVerifyError", "__version__"]
__version__ = "4.2.0"
