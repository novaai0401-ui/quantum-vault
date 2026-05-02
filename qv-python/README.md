# sigvault

[![PyPI](https://img.shields.io/pypi/v/sigvault.svg)](https://pypi.org/project/sigvault/)
[![Python versions](https://img.shields.io/pypi/pyversions/sigvault.svg)](https://pypi.org/project/sigvault/)
[![Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://github.com/007krcs/quantum-vault/blob/main/LICENSE)

Python client for **[Sigvault](https://github.com/007krcs/quantum-vault)** — post-quantum
(ML-DSA-87, Falcon-512/1024) cryptographic tokens over a zero-dependency REST API.

- **Stdlib-only.** No `requests`, no `httpx`, no compiled wheels. One universal
  wheel, works on Python 3.8+ everywhere (Linux, macOS, Windows, WASM, Alpine).
- **Talks to `qv-server`** — the same sovereign Node server available as a Docker
  image at `ghcr.io/007krcs/qv-server:4.2`.

## Install

```bash
pip install sigvault
```

## Run the server

```bash
docker run -p 7433:7433 \
  -e QV_MASTER_KEY_HEX=$(openssl rand -hex 32) \
  ghcr.io/007krcs/qv-server:4.2
```

## 30-second demo

```python
from sigvault import QVClient

qv = QVClient("http://localhost:7433")

key = qv.keygen(label="demo")
iss = qv.issue(
    key_id=key["keyId"],
    claims={"sub": "user-123", "role": "admin"},
    ttl=3600,
)

out = qv.verify(key_id=key["keyId"], token=iss["token"])
assert out["claims"]["sub"] == "user-123"
```

## Error handling

```python
from sigvault import QVClient, QVVerifyError, QVHTTPError

qv = QVClient("http://localhost:7433")
try:
    qv.verify(key_id=key_id, token=tampered_token)
except QVVerifyError as e:
    # Signature / expiry / replay / revocation failure.
    ...
except QVHTTPError as e:
    # Server returned 4xx/5xx for non-verification reasons.
    print(e.status, e.code, e.message)
```

## License

Apache-2.0.
