#!/usr/bin/env python3
"""
Local PII gate for 9router — LiquidAI/LFM2.5-Encoder-350M-PII-Detector.

POST /classify  {"text":"..."} → {"sensitive": bool, "types": [...], "spans": [...]}
GET  /healthz   → {"ok": true, "model": "...", "ready": bool}

Fail-soft for the gateway: 9router treats any error/timeout as non-sensitive.

Env:
  PII_GATE_HOST          default 127.0.0.1
  PII_GATE_PORT          default 20129
  PII_GATE_MODEL         default LiquidAI/LFM2.5-Encoder-350M-PII-Detector
  PII_GATE_MAX_CHARS     default 2000
  PII_GATE_DEVICE        cpu | mps | cuda  (default: mps if available else cpu)
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

MODEL_ID = os.environ.get(
    "PII_GATE_MODEL", "LiquidAI/LFM2.5-Encoder-350M-PII-Detector"
)
HOST = os.environ.get("PII_GATE_HOST", "127.0.0.1")
PORT = int(os.environ.get("PII_GATE_PORT", "20129"))
MAX_CHARS = int(os.environ.get("PII_GATE_MAX_CHARS", "2000"))

_lock = threading.Lock()
_state: dict = {"ready": False, "error": None, "tok": None, "model": None, "hd": None}


def _pick_device():
    forced = (os.environ.get("PII_GATE_DEVICE") or "").strip().lower()
    if forced in ("cpu", "mps", "cuda"):
        return forced
    try:
        import torch

        if torch.backends.mps.is_available():
            return "mps"
        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


def load_model():
    from huggingface_hub import hf_hub_download
    from transformers import AutoModelForTokenClassification, AutoTokenizer
    import torch

    helper_path = hf_hub_download(MODEL_ID, "pii_hybrid_decode.py")
    try:
        hf_hub_download(MODEL_ID, "context_cued.py")
    except Exception:
        pass
    sys.path.insert(0, helper_path.rsplit("/", 1)[0])
    spec = importlib.util.spec_from_file_location("pii_hybrid_decode", helper_path)
    hd = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(hd)

    device = _pick_device()
    tok = AutoTokenizer.from_pretrained(MODEL_ID, trust_remote_code=True)
    model = AutoModelForTokenClassification.from_pretrained(
        MODEL_ID, trust_remote_code=True
    ).eval()
    model.to(device)

    with _lock:
        _state.update(ready=True, error=None, tok=tok, model=model, hd=hd, device=device)
    print(f"[pii-gate] ready model={MODEL_ID} device={device}", flush=True)


def classify(text: str) -> dict:
    text = (text or "")[:MAX_CHARS]
    with _lock:
        if not _state["ready"]:
            return {"sensitive": False, "types": [], "spans": [], "error": "not_ready"}
        tok, model, hd = _state["tok"], _state["model"], _state["hd"]

    spans = hd.predict(text, tok, model) or []
    # Normalize to list of {type, text, start, end}
    out = []
    types = []
    for s in spans:
        if isinstance(s, dict):
            typ = s.get("type") or s.get("label") or "unknown"
            types.append(str(typ))
            out.append(
                {
                    "type": str(typ),
                    "text": s.get("text") or text[s.get("start", 0) : s.get("end", 0)],
                    "start": s.get("start"),
                    "end": s.get("end"),
                }
            )
    # Sensitive if any span. Credentials / identity / contact are the routing trigger.
    return {"sensitive": len(out) > 0, "types": sorted(set(types)), "spans": out}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _json(self, code: int, payload: dict):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ("/healthz", "/health", "/"):
            with _lock:
                ready = bool(_state["ready"])
                err = _state.get("error")
            self._json(
                200,
                {
                    "ok": True,
                    "model": MODEL_ID,
                    "ready": ready,
                    "error": err,
                },
            )
            return
        self._json(404, {"error": "not found"})

    def do_POST(self):
        path = urlparse(self.path).path
        if path not in ("/classify", "/v1/classify"):
            self._json(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            self._json(400, {"error": "invalid json"})
            return
        text = body.get("text") if isinstance(body, dict) else ""
        if not isinstance(text, str):
            text = str(text or "")
        try:
            result = classify(text)
            self._json(200, result)
        except Exception as e:
            self._json(500, {"sensitive": False, "types": [], "spans": [], "error": str(e)})


def main():
    # Load model in background so /healthz is up immediately.
    def _bg():
        try:
            load_model()
        except Exception as e:
            with _lock:
                _state["ready"] = False
                _state["error"] = str(e)
            print(f"[pii-gate] load failed: {e}", flush=True)

    threading.Thread(target=_bg, daemon=True).start()
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[pii-gate] listening http://{HOST}:{PORT}  classify→POST /classify", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
