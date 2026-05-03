"""
Offline smoke tests — we don't spin up a server here, we just verify the
client wires URLs, payloads, and error classes correctly. Integration
against a real qv-server is covered in the Node/Rust test suites.
"""
from __future__ import annotations

import io
import json
from unittest.mock import patch

import urllib.error

from sigvault import QVClient, QVError, QVHTTPError, QVVerifyError


def _mock_response(body: dict, status: int = 200):
    class _R:
        def __enter__(self):
            return self
        def __exit__(self, *a):
            pass
        def read(self):
            return json.dumps(body).encode()
        @property
        def headers(self):
            return {"content-type": "application/json"}
    return _R()


def test_client_builds_request_correctly():
    qv = QVClient("http://localhost:7433")
    captured = {}

    def fake_urlopen(req, timeout, context):
        captured["url"] = req.full_url
        captured["method"] = req.get_method()
        captured["body"] = req.data
        return _mock_response({"keyId": "abc", "label": "demo"})

    with patch("urllib.request.urlopen", side_effect=fake_urlopen):
        out = qv.keygen(label="demo")

    assert out["keyId"] == "abc"
    assert captured["url"] == "http://localhost:7433/v3/keygen"
    assert captured["method"] == "POST"
    assert json.loads(captured["body"].decode()) == {"label": "demo"}


def test_verify_error_is_distinct_class():
    qv = QVClient("http://localhost:7433")

    def boom(*a, **kw):
        raise urllib.error.HTTPError(
            url="x", code=401, msg="bad sig", hdrs=None,
            fp=io.BytesIO(json.dumps({"code": "BAD_SIG", "message": "nope"}).encode()),
        )

    with patch("urllib.request.urlopen", side_effect=boom):
        try:
            qv.verify(key_id="k", token="deadbeef")
        except QVVerifyError as e:
            assert "nope" in str(e)
        else:
            raise AssertionError("QVVerifyError should have been raised")


def test_other_http_errors_surface_as_qvhttperror():
    qv = QVClient("http://localhost:7433")

    def boom(*a, **kw):
        raise urllib.error.HTTPError(
            url="x", code=500, msg="ise", hdrs=None,
            fp=io.BytesIO(json.dumps({"code": "INTERNAL", "message": "boom"}).encode()),
        )

    with patch("urllib.request.urlopen", side_effect=boom):
        try:
            qv.health()
        except QVHTTPError as e:
            assert e.status == 500
            assert e.code == "INTERNAL"
        else:
            raise AssertionError("QVHTTPError should have been raised")


def test_error_hierarchy():
    # QVHTTPError and QVVerifyError both inherit from QVError.
    assert issubclass(QVHTTPError, QVError)
    assert issubclass(QVVerifyError, QVError)
